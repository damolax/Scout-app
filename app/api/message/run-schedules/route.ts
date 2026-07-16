export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { analyzeSpamRisk } from "@/lib/spam-guard";
import { createAppNotification } from "@/lib/notifications";
import { buildMimeMessage, appendSignatureToText, EmailAttachment } from "@/lib/email-signature";
import { applyCountryFilter, businessMatchesCountry, extractBusinessCountries } from "@/lib/country-location";
import { resolveTemplateContent } from "@/lib/template-language";
import { businessIdentityKeys } from "@/lib/normalize";
import { configuredRunLimit, effectiveDailyLimit, nextDelayMs, sendingMode } from "@/lib/sending-safety";

type AnyRow = Record<string, any>;

type WorkerSummary = {
  scheduleId: string;
  status: "sent" | "failed" | "skipped" | "running" | "queued";
  type?: string;
  requested: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  reason?: string;
  batchId?: string;
};

const MAX_WORKER_BATCH_SIZE = 1000;
const MAX_EMAILS_PER_SENDER_PER_RUN = 250;
const MAX_ACTIVE_SENDER_LANES = Math.max(1, Math.min(500, Number(process.env.SCOUT_MAX_ACTIVE_SENDER_LANES || 12)));
const MAX_ACTIVE_SENDER_LANES_PER_WORKSPACE = Math.max(1, Math.min(50, Number(process.env.SCOUT_MAX_ACTIVE_SENDER_LANES_PER_WORKSPACE || 2)));
const MAX_ACTIVE_CAMPAIGNS = Math.max(1, Math.min(200, Number(process.env.SCOUT_MAX_ACTIVE_CAMPAIGNS || 12)));
const MAX_ACTIVE_CAMPAIGNS_PER_WORKSPACE = Math.max(1, Math.min(25, Number(process.env.SCOUT_MAX_ACTIVE_CAMPAIGNS_PER_WORKSPACE || 1)));
const MAX_SCHEDULES_PER_RUN = 6;
const MAX_FAST_MESSAGES_PER_LANE_PASS = Math.max(1, Math.min(10, Number(process.env.SCOUT_FAST_MESSAGES_PER_LANE_PASS || 5)));
const CONTACTABLE_BUSINESS_STATUSES = ["ready", "found", "connected"];
const LOCATION_RAW_KEYS = [
  "location",
  "country",
  "country_name",
  "countryName",
  "market",
  "city",
  "region",
  "state",
  "province",
  "address",
  "business_location",
  "businessLocation",
  "hq_location",
  "headquarters",
  "territory",
];

function b64url(input: string) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function sleep(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}


function scheduleWorkerSecretFromRequest(
  request: NextRequest,
  body?: Record<string, unknown>,
) {
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  return String(
    body?.token ||
      request.nextUrl.searchParams.get("token") ||
      request.headers.get("x-schedule-worker-secret") ||
      bearer ||
      "",
  );
}

function normalizeEmail(email: unknown) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function cleanLocationValue(value: unknown) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length > 90) return "";
  const lower = cleaned.toLowerCase();
  if (lower.includes("@")) return "";
  if (lower.startsWith("http")) return "";
  if (lower.includes("www.")) return "";
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) return "";
  return cleaned;
}

function addLocationCandidate(target: Set<string>, value: unknown) {
  const cleaned = cleanLocationValue(value);
  if (!cleaned) return;
  const parts = cleaned
    .split(/[|;\n]/g)
    .map((item) => cleanLocationValue(item))
    .filter(Boolean);
  if (parts.length > 1) {
    parts.forEach((part) => target.add(part));
    return;
  }
  target.add(cleaned);
}

function extractBusinessLocations(business: AnyRow) {
  return extractBusinessCountries(business);
}

function businessMatchesLocation(business: AnyRow, selectedLocation: string) {
  return businessMatchesCountry(business, selectedLocation);
}

function applyLocationFilter(rows: AnyRow[], selectedLocation: string) {
  return applyCountryFilter(rows, selectedLocation);
}

function isMissingRpcFunction(error: unknown) {
  const text = formatError(error).toLowerCase();
  return (
    text.includes("pgrst202") ||
    text.includes("get_due_followups") ||
    text.includes("schema cache")
  );
}

function looksLikeLimit(message: string, status: number) {
  const text = message.toLowerCase();
  return (
    status === 429 ||
    text.includes("rate limit") ||
    text.includes("daily") ||
    text.includes("quota") ||
    text.includes("user-rate") ||
    text.includes("limit exceeded") ||
    text.includes("rate_limit_exceeded") ||
    text.includes("userratelimitexceeded") ||
    text.includes("mailratelimitexceeded") ||
    text.includes("recipientratelimitexceeded")
  );
}

function looksLikeMessageBlocked(message: string, status: number) {
  const text = message.toLowerCase();
  return (
    status === 403 ||
    text.includes("message blocked") ||
    text.includes("blocked") ||
    text.includes("policy") ||
    text.includes("spam") ||
    text.includes("rejected")
  );
}

function isPaused(account: AnyRow) {
  const status = String(account.status || "").toLowerCase();
  if (account.is_paused === true || ["limit_hit", "paused", "blocked"].includes(status)) return true;
  if (!account.paused_until) return false;
  return new Date(account.paused_until).getTime() > Date.now();
}

function splitSubjects(subject: string, variants?: string[] | null) {
  const all = [subject, ...(variants || [])]
    .flatMap((item) => String(item || "").split("\n"))
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(all));
}

function getDomain(business: AnyRow) {
  if (business.domain) return String(business.domain);
  try {
    if (business.website)
      return new URL(
        String(business.website).startsWith("http")
          ? String(business.website)
          : `https://${business.website}`,
      ).hostname.replace(/^www\./, "");
  } catch {}
  return String(business.email || "").split("@")[1] || "";
}

function renderTemplate(text: string, business: AnyRow) {
  const domain = getDomain(business);
  const values: Record<string, string> = {
    name: business.name || "there",
    business: business.name || "your business",
    company: business.name || "your company",
    email: business.email || "",
    website: business.website || domain || "",
    domain,
    phone: business.phone || "",
    category: business.category || "business",
    industry: business.category || "business",
    location: business.location || "your area",
    source: business.source || "Scout",
  };
  return String(text || "").replace(
    /\{([a-zA-Z0-9_]+)\}/g,
    (_match, key) => values[String(key).toLowerCase()] ?? "",
  );
}

function requestedRunLimit(scheduleRaw: AnyRow, account: AnyRow, senderRunLimitOverride?: number) {
  const caps = scheduleRaw?.sender_run_limits || {};
  const byEmail = caps[String(account.email || '')];
  const byId = caps[String(account.id || '')];
  const raw = senderRunLimitOverride && senderRunLimitOverride > 0 ? senderRunLimitOverride : byId ?? byEmail;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '' && String(raw).toLowerCase() !== 'auto') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(MAX_EMAILS_PER_SENDER_PER_RUN, Math.floor(parsed));
  }
  return Math.min(MAX_EMAILS_PER_SENDER_PER_RUN, configuredRunLimit(account));
}

type SlotReservation = {
  allowed: boolean;
  reservationId: string | null;
  reason: string;
  sentToday: number;
  sentRolling24h: number;
  sentThisRun: number;
};


type ScaleLease = {
  allowed: boolean;
  token: string | null;
  slot: number | null;
  reason: string;
};

async function acquireCampaignLease(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  scheduleId: string,
): Promise<ScaleLease> {
  const { data, error } = await supabase.rpc('acquire_scout_campaign_lease', {
    p_workspace_id: workspaceId,
    p_schedule_id: scheduleId,
    p_platform_limit: MAX_ACTIVE_CAMPAIGNS,
    p_workspace_limit: MAX_ACTIVE_CAMPAIGNS_PER_WORKSPACE,
    p_lease_seconds: 900,
  });
  if (error) throw new Error(`Scale Guard campaign lease failed: ${formatError(error)}. Run RUN_THIS_SQL_FIRST_V10_35_1_SCALE_GUARD.sql.`);
  const row = Array.isArray(data) ? data[0] : data;
  return { allowed: Boolean(row?.allowed), token: row?.lease_token ? String(row.lease_token) : null, slot: row?.slot == null ? null : Number(row.slot), reason: String(row?.reason || '') };
}

async function renewCampaignLease(supabase: ReturnType<typeof createAdminClient>, token: string | null) {
  if (!token) return;
  await supabase.rpc('renew_scout_campaign_lease', { p_lease_token: token, p_lease_seconds: 900 });
}

async function releaseCampaignLease(supabase: ReturnType<typeof createAdminClient>, token: string | null) {
  if (!token) return;
  await supabase.rpc('release_scout_campaign_lease', { p_lease_token: token });
}

async function acquireSenderLaneLease(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  scheduleId: string,
  gmailAccountId: string,
): Promise<ScaleLease> {
  const { data, error } = await supabase.rpc('acquire_scout_sender_lane', {
    p_workspace_id: workspaceId,
    p_schedule_id: scheduleId,
    p_gmail_account_id: gmailAccountId,
    p_platform_limit: MAX_ACTIVE_SENDER_LANES,
    p_workspace_limit: MAX_ACTIVE_SENDER_LANES_PER_WORKSPACE,
    p_lease_seconds: 600,
  });
  if (error) throw new Error(`Scale Guard sender lease failed: ${formatError(error)}. Run RUN_THIS_SQL_FIRST_V10_35_1_SCALE_GUARD.sql.`);
  const row = Array.isArray(data) ? data[0] : data;
  return { allowed: Boolean(row?.allowed), token: row?.lease_token ? String(row.lease_token) : null, slot: row?.slot == null ? null : Number(row.slot), reason: String(row?.reason || '') };
}

async function renewSenderLaneLease(supabase: ReturnType<typeof createAdminClient>, token: string | null) {
  if (!token) return;
  await supabase.rpc('renew_scout_sender_lane', { p_lease_token: token, p_lease_seconds: 600 });
}

async function releaseSenderLaneLease(supabase: ReturnType<typeof createAdminClient>, token: string | null) {
  if (!token) return;
  await supabase.rpc('release_scout_sender_lane', { p_lease_token: token });
}

async function reserveSenderSlot(
  supabase: ReturnType<typeof createAdminClient>,
  input: { workspaceId: string; account: AnyRow; scheduleId: string; batchId: string; timezone: string; runLimit: number },
): Promise<SlotReservation> {
  const dailyLimit = Math.max(1, Math.min(2000, Number(input.account.daily_limit || 250)));
  const safeLimit = Math.max(0, effectiveDailyLimit(input.account));
  if (safeLimit <= 0) return { allowed: false, reservationId: null, reason: 'Sender health or warm-up allowance is paused.', sentToday: 0, sentRolling24h: 0, sentThisRun: 0 };
  const { data, error } = await supabase.rpc('reserve_scout_sender_slot', {
    p_workspace_id: input.workspaceId,
    p_gmail_account_id: String(input.account.id),
    p_schedule_id: input.scheduleId,
    p_batch_id: input.batchId,
    p_timezone: input.timezone || 'UTC',
    p_daily_limit: dailyLimit,
    p_effective_limit: safeLimit,
    p_run_limit: input.runLimit,
  });
  if (error) {
    const text = formatError(error).toLowerCase();
    if (text.includes('reserve_scout_sender_slot') || text.includes('pgrst202') || text.includes('schema cache')) {
      // Backward-compatible fallback while the additive v10.35 SQL is being applied.
      // It is conservative but the migration is still required for cross-job atomicity.
      const rollingSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [{ count: rolling }, { count: run }] = await Promise.all([
        supabase.from('sent_messages').select('id', { count: 'exact', head: true }).eq('workspace_id', input.workspaceId).eq('gmail_account_id', input.account.id).eq('status', 'sent').gte('sent_at', rollingSince),
        supabase.from('sent_messages').select('id', { count: 'exact', head: true }).eq('workspace_id', input.workspaceId).eq('gmail_account_id', input.account.id).eq('status', 'sent').contains('raw', { schedule_id: input.scheduleId }),
      ]);
      const sentRolling = Number(rolling || 0);
      const sentRun = Number(run || 0);
      const allowed = sentRolling < Math.min(dailyLimit, safeLimit) && sentRun < input.runLimit;
      return { allowed, reservationId: null, reason: allowed ? 'Fallback safety check.' : 'Safe sending limit reached.', sentToday: Number(input.account.sent_today || 0), sentRolling24h: sentRolling, sentThisRun: sentRun };
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: Boolean(row?.allowed),
    reservationId: row?.reservation_id ? String(row.reservation_id) : null,
    reason: String(row?.reason || ''),
    sentToday: Number(row?.sent_today || 0),
    sentRolling24h: Number(row?.sent_rolling_24h || 0),
    sentThisRun: Number(row?.sent_this_run || 0),
  };
}

async function finalizeSenderSlot(supabase: ReturnType<typeof createAdminClient>, reservationId: string | null, success: boolean, error?: string) {
  if (!reservationId) return;
  await supabase.rpc('finalize_scout_sender_slot', { p_reservation_id: reservationId, p_success: success, p_error: error || null });
}


async function loadScheduleControl(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  scheduleId: string,
) {
  const { data } = await supabase
    .from("message_schedules")
    .select("status,stop_requested")
    .eq("workspace_id", workspaceId)
    .eq("id", scheduleId)
    .maybeSingle();
  return {
    stopRequested: Boolean((data as AnyRow | null)?.stop_requested) || String((data as AnyRow | null)?.status || "") === "cancelled",
    status: String((data as AnyRow | null)?.status || ""),
  };
}

function templateAttachments(template: AnyRow) {
  const direct = Array.isArray(template.attachments) ? template.attachments : [];
  const raw = template.raw && Array.isArray(template.raw.attachments) ? template.raw.attachments : [];
  return direct.length ? direct : raw;
}

function safeAttachmentName(value: unknown) {
  return String(value || 'attachment').replace(/[\r\n"\\]+/g, ' ').trim().slice(0, 180) || 'attachment';
}

async function prepareAttachments(items: unknown): Promise<EmailAttachment[]> {
  if (!Array.isArray(items)) return [];
  const selected = items.slice(0, 5);
  const attachments: EmailAttachment[] = [];
  let totalBytes = 0;
  for (const item of selected) {
    const row = (item || {}) as AnyRow;
    const url = String(row.public_url || row.url || '').trim();
    if (!url) continue;
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) continue;
    const response = await fetch(parsed.toString());
    if (!response.ok) throw new Error(`Attachment download failed for ${safeAttachmentName(row.name || row.filename)} with HTTP ${response.status}`);
    const contentType = String(row.mime_type || row.mimeType || response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    const buffer = Buffer.from(await response.arrayBuffer());
    totalBytes += buffer.length;
    if (buffer.length > 10 * 1024 * 1024) throw new Error(`${safeAttachmentName(row.name || row.filename)} is over 10 MB.`);
    if (totalBytes > 18 * 1024 * 1024) throw new Error('Attachments are too large together. Keep total attachments under about 18 MB.');
    attachments.push({
      filename: safeAttachmentName(row.filename || row.name || parsed.pathname.split('/').pop() || 'attachment'),
      mimeType: contentType,
      contentBase64: buffer.toString('base64'),
      sizeBytes: buffer.length,
    });
  }
  return attachments;
}

async function pauseSenderForLimit(supabase: ReturnType<typeof createAdminClient>, workspaceId: string, accountId: string, reason: string, until: string) {
  const rich = await supabase.from('gmail_accounts').update({
    status: 'limit_hit',
    paused_until: until,
    is_paused: true,
    paused_reason: reason,
    last_error: reason,
    health_status: 'sender_limited',
    last_provider_limit_at: new Date().toISOString(),
    provider_limit_count: 1,
    updated_at: new Date().toISOString(),
  }).eq('workspace_id', workspaceId).eq('id', accountId);
  if (rich.error) {
    await supabase.from('gmail_accounts').update({
      status: 'limit_hit',
      paused_until: until,
      last_error: reason,
      updated_at: new Date().toISOString(),
    }).eq('workspace_id', workspaceId).eq('id', accountId);
  }
}

async function refreshAccessToken(account: AnyRow) {
  const clientId =
    process.env.GOOGLE_CLIENT_ID ||
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  if (!clientId || !clientSecret)
    throw new Error(
      "GOOGLE_CLIENT_ID/NEXT_PUBLIC_GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in Vercel.",
    );
  if (!account.refresh_token)
    throw new Error(
      `No refresh token for ${account.email}. Reconnect Gmail in Settings.`,
    );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: String(account.refresh_token),
      grant_type: "refresh_token",
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      json?.error_description ||
        json?.error ||
        `Token refresh failed with HTTP ${response.status}`,
    );
  return {
    access_token: String(json.access_token || ""),
    expires_in: Number(json.expires_in || 3600),
  };
}

async function sendWithGmail(
  accessToken: string,
  from: string,
  to: string,
  subject: string,
  body: string,
  identity?: Record<string, unknown>,
  attachments?: EmailAttachment[],
) {
  const message = buildMimeMessage({ from, to, subject, body, identity, attachments });
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw: b64url(message.raw) }),
    },
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg =
      json?.error?.message ||
      json?.error ||
      `Gmail send failed with HTTP ${response.status}`;
    const err = new Error(msg) as Error & {
      status?: number;
      payload?: unknown;
      limitHit?: boolean;
      blocked?: boolean;
    };
    err.status = response.status;
    err.payload = json;
    err.limitHit = looksLikeLimit(msg, response.status);
    err.blocked = looksLikeMessageBlocked(msg, response.status);
    throw err;
  }
  return json as { id?: string; threadId?: string; labelIds?: string[] };
}

async function ensureAccessToken(
  supabase: ReturnType<typeof createAdminClient>,
  account: AnyRow,
) {
  let accessToken = String(account.access_token || "");
  const expiresAt = account.expires_at
    ? new Date(account.expires_at).getTime()
    : 0;
  if (!accessToken || expiresAt < Date.now() + 60_000) {
    const refreshed = await refreshAccessToken(account);
    accessToken = refreshed.access_token;
    await supabase
      .from("gmail_accounts")
      .update({
        access_token: accessToken,
        expires_at: new Date(
          Date.now() + refreshed.expires_in * 1000,
        ).toISOString(),
        last_error: null,
      })
      .eq("workspace_id", account.workspace_id)
      .eq("id", account.id);
    account.access_token = accessToken;
    account.expires_at = new Date(
      Date.now() + refreshed.expires_in * 1000,
    ).toISOString();
  }
  return accessToken;
}

async function loadTemplates(
  supabase: ReturnType<typeof createAdminClient>,
  schedule: AnyRow,
) {
  const desiredTypes =
    schedule.type === "follow_up" ? ["follow_up"] : ["initial"];
  if (schedule.template_id) {
    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .eq("workspace_id", schedule.workspace_id)
      .eq("id", schedule.template_id)
      .eq("active", true)
      .limit(1);
    if (error) throw error;
    return (data || []).filter((t: AnyRow) =>
      desiredTypes.includes(String(t.template_type || "initial")),
    );
  }
  let query = supabase
    .from("templates")
    .select("*")
    .eq("workspace_id", schedule.workspace_id)
    .eq("active", true)
    .in("template_type", desiredTypes)
    .order("created_at", { ascending: false })
    .limit(50);
  if (schedule.category_id)
    query = query.eq("category_id", schedule.category_id);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadAccounts(
  supabase: ReturnType<typeof createAdminClient>,
  schedule: AnyRow,
) {
  const raw = schedule.raw || {};
  // Provider-limit pauses expire automatically. The sender returns in
  // Recovering mode; other sender lanes are never interrupted.
  const recovery = await supabase.from('gmail_accounts').update({
    status: 'connected',
    is_paused: false,
    paused_reason: null,
    health_status: 'recovering',
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('workspace_id', schedule.workspace_id).in('status', ['limit_hit', 'sender_limited']).lte('paused_until', new Date().toISOString());
  if (recovery.error && String(recovery.error.message || '').toLowerCase().includes('health_status')) {
    await supabase.from('gmail_accounts').update({ status: 'connected', is_paused: false, paused_reason: null, last_error: null, updated_at: new Date().toISOString() }).eq('workspace_id', schedule.workspace_id).in('status', ['limit_hit', 'sender_limited']).lte('paused_until', new Date().toISOString());
  }
  const selectedIds = Array.isArray(raw.selected_sender_ids)
    ? raw.selected_sender_ids.map(String).filter(Boolean)
    : [];
  let query = supabase
    .from("gmail_accounts")
    .select("*")
    .eq("workspace_id", schedule.workspace_id)
    .in("status", ["connected", "ready"]);
  if (selectedIds.length) query = query.in("id", selectedIds);
  const { data, error } = await query
    .order("last_successful_send_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).filter(
    (account) =>
      !isPaused(account) && (account.access_token || account.refresh_token),
  );
}

async function guardTeamBusinessForSend(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  businessId: string,
) {
  const { data: rows, error: businessError } = await supabase
    .from('businesses')
    .select('id,normalized_key,email,domain,website,phone,name')
    .eq('workspace_id', workspaceId)
    .eq('id', businessId)
    .limit(1);
  if (businessError) throw businessError;
  const business = rows?.[0];
  if (!business) return { allowed: false, ownerWorkspaceId: null, conflictKey: null };
  const keys = businessIdentityKeys(business as any);
  if (!keys.length) return { allowed: true, ownerWorkspaceId: workspaceId, conflictKey: null };
  const { data: claims, error: claimError } = await supabase
    .from('team_scouted_leads')
    .select('normalized_key,first_workspace_id')
    .in('normalized_key', keys);
  if (claimError) throw claimError;
  const conflict = (claims || []).find((row: any) => !row.first_workspace_id || String(row.first_workspace_id) !== workspaceId);
  return {
    allowed: !conflict,
    ownerWorkspaceId: conflict ? String(conflict.first_workspace_id) : workspaceId,
    conflictKey: conflict ? String(conflict.normalized_key || '') : null
  };
}

async function filterTeamSendableBusinesses(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  businesses: AnyRow[],
) {
  if (!businesses.length) return { allowed: [] as AnyRow[], blocked: 0 };
  const rowKeys = new Map<string, string[]>();
  const allKeys = new Set<string>();
  for (const business of businesses) {
    const id = String(business.id || '');
    const keys = businessIdentityKeys(business as any);
    rowKeys.set(id, keys);
    for (const key of keys) allKeys.add(key);
  }
  if (!allKeys.size) return { allowed: businesses, blocked: 0 };
  const blockedKeys = new Set<string>();
  const keys = Array.from(allKeys);
  for (let index = 0; index < keys.length; index += 1000) {
    const { data, error } = await supabase
      .from('team_scouted_leads')
      .select('normalized_key,first_workspace_id')
      .in('normalized_key', keys.slice(index, index + 1000));
    if (error) throw error;
    for (const row of data || []) {
      if (!row.first_workspace_id || String(row.first_workspace_id) !== workspaceId) blockedKeys.add(String(row.normalized_key || ''));
    }
  }
  const isBlocked = (business: AnyRow) => (rowKeys.get(String(business.id || '')) || []).some((key) => blockedKeys.has(key));
  return {
    allowed: businesses.filter((business) => !isBlocked(business)),
    blocked: businesses.filter(isBlocked).length
  };
}

async function loadReadyBusinesses(
  supabase: ReturnType<typeof createAdminClient>,
  schedule: AnyRow,
  limit: number,
) {
  const raw = schedule.raw || {};
  const selectedIds = Array.isArray(raw.selected_business_ids)
    ? raw.selected_business_ids.map(String).filter(Boolean).slice(0, limit)
    : [];
  const cleanCategory = String(raw.business_category_filter || "")
    .trim()
    .replace(/[%_]/g, "");
  const cleanSearch = String(raw.ready_search || "")
    .trim()
    .replace(/[%_]/g, "");
  const cleanLocation = String(raw.location_filter || raw.country_filter || "")
    .trim()
    .replace(/[%_]/g, "");
  const audienceCategoryId = String(
    schedule.audience_category_id || raw.audience_category_id || "",
  ).trim();

  const unique = new Map<string, AnyRow>();

  if (selectedIds.length || !cleanLocation) {
    let query = supabase
      .from("businesses")
      .select("*")
      .eq("workspace_id", schedule.workspace_id)
      .in("status", CONTACTABLE_BUSINESS_STATUSES)
      .not("email", "is", null)
      .neq("email", "")
      .order("updated_at", { ascending: true })
      .limit(selectedIds.length ? Math.max(limit, selectedIds.length) : limit);

    if (selectedIds.length) query = query.in("id", selectedIds);
    if (audienceCategoryId) query = query.eq("category_id", audienceCategoryId);
    else if (cleanCategory) query = query.ilike("category", `%${cleanCategory}%`);
    if (cleanSearch)
      query = query.or(
        `name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,domain.ilike.%${cleanSearch}%,website.ilike.%${cleanSearch}%`,
      );

    const { data, error } = await query;
    if (error) throw error;
    for (const row of applyLocationFilter((data || []) as AnyRow[], cleanLocation)) {
      const email = normalizeEmail(row.email);
      if (email && !unique.has(email)) unique.set(email, row);
    }
  } else {
    // Country filtering is derived from the complete uploaded business record,
    // not a database text search. Page until enough exact matches are found so
    // countries beyond the old 10,000-row cutoff remain sendable.
    const pageSize = 1000;
    for (let offset = 0; unique.size < limit; offset += pageSize) {
      let query = supabase
        .from("businesses")
        .select("*")
        .eq("workspace_id", schedule.workspace_id)
        .in("status", CONTACTABLE_BUSINESS_STATUSES)
        .not("email", "is", null)
        .neq("email", "")
        .order("updated_at", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (audienceCategoryId) query = query.eq("category_id", audienceCategoryId);
      else if (cleanCategory) query = query.ilike("category", `%${cleanCategory}%`);
      if (cleanSearch)
        query = query.or(
          `name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,domain.ilike.%${cleanSearch}%,website.ilike.%${cleanSearch}%`,
        );
      const { data, error } = await query;
      if (error) throw error;
      const pageRows = (data || []) as AnyRow[];
      for (const row of applyLocationFilter(pageRows, cleanLocation)) {
        const email = normalizeEmail(row.email);
        if (email && !unique.has(email)) unique.set(email, row);
        if (unique.size >= limit) break;
      }
      if (pageRows.length < pageSize) break;
    }
  }

  const candidates = Array.from(unique.values()).slice(0, limit);
  const guarded = await filterTeamSendableBusinesses(
    supabase,
    String(schedule.workspace_id),
    candidates,
  );
  return guarded.allowed;
}

async function loadFollowUpBusinesses(
  supabase: ReturnType<typeof createAdminClient>,
  schedule: AnyRow,
  limit: number,
) {
  const raw = schedule.raw || {};
  const dueIds = Array.isArray(raw.due_business_ids)
    ? raw.due_business_ids.map(String).filter(Boolean)
    : [];
  const segment = String(
    raw.followup_segment || schedule.followup_segment || "all_unanswered",
  );
  const rpcLimit = Math.max(limit, dueIds.length || 0, 1);
  const { data: dueRows, error: dueError } = await supabase.rpc(
    "get_due_followups",
    {
      target_workspace: schedule.workspace_id,
      limit_rows: rpcLimit,
      followup_segment: segment,
    },
  );
  if (dueError) {
    if (isMissingRpcFunction(dueError))
      throw new Error(
        "Supabase follow-up function is missing. Run supabase/migrations/202607100839_simple_targeting_followup_rpc.sql once, then retry schedules.",
      );
    throw dueError;
  }

  const dueSet = new Set(
    (dueRows || [])
      .map((row: AnyRow) => String(row.business_id || ""))
      .filter(Boolean),
  );
  const ids = dueIds.length
    ? dueIds.filter((id: string) => dueSet.has(id)).slice(0, limit)
    : Array.from(dueSet).slice(0, limit);
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("workspace_id", schedule.workspace_id)
    .in("id", ids)
    .not("email", "is", null)
    .neq("email", "");
  if (error) throw error;
  const byId = new Map(
    (data || []).map((row: AnyRow) => [String(row.id), row]),
  );
  const candidates = ids
    .map((id: string) => byId.get(id))
    .filter(Boolean) as AnyRow[];
  const guarded = await filterTeamSendableBusinesses(
    supabase,
    String(schedule.workspace_id),
    candidates,
  );
  return guarded.allowed;
}

async function runOneSchedule(
  supabase: ReturnType<typeof createAdminClient>,
  schedule: AnyRow,
  targetLimitOverride?: number,
  senderRunLimitOverride?: number,
): Promise<WorkerSummary> {
  const scheduleId = String(schedule.id);
  const workspaceId = String(schedule.workspace_id);
  const raw = schedule.raw || {};
  const totalTarget = Math.max(1, Number(schedule.target_count || 100));
  const baseProcessed = Math.max(0, Number(schedule.processed_count || 0));
  const baseSent = Math.max(0, Number(schedule.sent_count || 0));
  const baseFailed = Math.max(0, Number(schedule.failed_count || 0));
  const baseSkipped = Math.max(0, Number(schedule.skipped_count || 0));
  const remainingTarget = Math.max(0, totalTarget - baseProcessed);
  const requestedTarget = targetLimitOverride && targetLimitOverride > 0
    ? Math.min(targetLimitOverride, remainingTarget || targetLimitOverride)
    : (remainingTarget || totalTarget);

  const lock = await supabase
    .from("message_schedules")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
      stop_requested: false,
      stopped_at: null,
    })
    .eq("id", scheduleId)
    .eq("workspace_id", workspaceId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (lock.error) throw lock.error;
  if (!lock.data)
    return {
      scheduleId,
      status: "skipped",
      requested: Math.max(1, Math.min(MAX_WORKER_BATCH_SIZE, requestedTarget)),
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      reason: "Already running or not scheduled.",
    };

  let campaignLeaseToken: string | null = null;
  const campaignLease = await acquireCampaignLease(supabase, workspaceId, scheduleId);
  if (!campaignLease.allowed) {
    await supabase.from("message_schedules").update({
      status: "scheduled",
      last_error: campaignLease.reason || "Queued for central worker capacity.",
      updated_at: new Date().toISOString(),
    }).eq("workspace_id", workspaceId).eq("id", scheduleId);
    return {
      scheduleId,
      status: "queued",
      type: schedule.type,
      requested: Math.max(1, Math.min(MAX_WORKER_BATCH_SIZE, requestedTarget)),
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      reason: campaignLease.reason || "Queued for capacity.",
    };
  }
  campaignLeaseToken = campaignLease.token;

  const batchId = `schedule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let stopped = false;
  let batchCreated = false;

  try {
    const templates = await loadTemplates(supabase, schedule);
    if (!templates.length)
      throw new Error("No active template found for this schedule.");

    const loadedAccounts = await loadAccounts(supabase, schedule);
    if (!loadedAccounts.length)
      throw new Error("No connected sender available for this schedule.");

    const templateMode = String(
      raw.template_mode || (schedule.template_id ? "specific" : "rotate"),
    );
    const senderMode = String(raw.sender_mode || "rotate");
    const allowHighRiskSend = Boolean(raw.allow_high_risk_send);
    const dryRun = Boolean(raw.dry_run);
    const { data: workspaceSettings } = await supabase.from('workspaces').select('timezone').eq('id', workspaceId).maybeSingle();
    const workspaceTimezone = String((workspaceSettings as AnyRow | null)?.timezone || 'UTC');

    const laneAccounts = (senderMode === "specific"
      ? loadedAccounts.slice(0, 1)
      : loadedAccounts
    ).filter((account) => requestedRunLimit(raw, account, senderRunLimitOverride) > 0 && effectiveDailyLimit(account) > 0);
    if (!laneAccounts.length)
      throw new Error("All selected senders reached their run or daily limits.");

    // Choose each sender's pacing delay once for this pass. This prevents a
    // Normal/Warm-up sender from being repeatedly polled while it is not due,
    // and allows the worker to rotate through all 150 connected accounts.
    const pacingDelayByAccount = new Map<string, number>();
    for (const account of laneAccounts) {
      pacingDelayByAccount.set(String(account.id), dryRun ? 0 : nextDelayMs(account));
    }
    const passStartedAt = Date.now();
    const passCandidateAccounts = laneAccounts.filter((account) => {
      if (dryRun || !account.last_successful_send_at) return true;
      const previous = new Date(account.last_successful_send_at).getTime();
      if (!Number.isFinite(previous)) return true;
      const requiredDelay = pacingDelayByAccount.get(String(account.id)) || 0;
      return passStartedAt - previous >= Math.max(0, requiredDelay - 1_500);
    });
    if (!passCandidateAccounts.length) {
      const nextWaitMs = Math.min(
        ...laneAccounts.map((account) => {
          const previous = account.last_successful_send_at
            ? new Date(account.last_successful_send_at).getTime()
            : 0;
          const requiredDelay = pacingDelayByAccount.get(String(account.id)) || 0;
          return previous ? Math.max(1_000, requiredDelay - (passStartedAt - previous)) : 1_000;
        }),
      );
      await supabase.from("message_schedules").update({
        status: "scheduled",
        scheduled_for: new Date(Date.now() + Math.min(60_000, Math.max(1_000, nextWaitMs))).toISOString(),
        last_error: "Waiting for the next sender pacing window.",
        updated_at: new Date().toISOString(),
      }).eq("workspace_id", workspaceId).eq("id", scheduleId);
      return {
        scheduleId,
        status: "queued",
        type: schedule.type,
        requested: Math.max(1, Math.min(MAX_WORKER_BATCH_SIZE, requestedTarget)),
        attempted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        reason: "Waiting for sender pacing.",
      };
    }

    // One short resource-safe pass activates at most the configured workspace
    // lanes. Fast senders may send a small burst; Normal/Warm-up senders send
    // one message and return control to the fair central queue.
    const maxMessagesPerLanePass = passCandidateAccounts.reduce((maximum, account) => {
      const cap = sendingMode(account) === "fast" ? MAX_FAST_MESSAGES_PER_LANE_PASS : 1;
      return Math.max(maximum, cap);
    }, 1);
    const dynamicChunkCapacity = Math.max(
      1,
      MAX_ACTIVE_SENDER_LANES_PER_WORKSPACE * maxMessagesPerLanePass,
    );
    const targetCount = Math.max(
      1,
      Math.min(MAX_WORKER_BATCH_SIZE, requestedTarget, dynamicChunkCapacity),
    );

    const sampleBusiness = {
      name: "there",
      email: "test@example.com",
      website: "",
      domain: "",
      category: "",
      location: "",
      source: "Scout",
    };
    const sampleTemplate = templates[0];
    const sampleLocalized = resolveTemplateContent(sampleTemplate, sampleBusiness);
    const sampleSubject = renderTemplate(
      splitSubjects(
        sampleLocalized.subject,
        sampleLocalized.subjectVariants,
      )[0] || sampleLocalized.subject,
      sampleBusiness,
    );
    const sampleBody = renderTemplate(
      sampleLocalized.message,
      sampleBusiness,
    );
    const guard = analyzeSpamRisk(sampleSubject, sampleBody);
    if (guard.level === "High" && !allowHighRiskSend && !dryRun)
      throw new Error(
        `Spam Guard blocked scheduled send. Template risk is HIGH (${guard.score}/100).`,
      );

    const contacts =
      schedule.type === "follow_up"
        ? await loadFollowUpBusinesses(supabase, schedule, targetCount)
        : await loadReadyBusinesses(supabase, schedule, targetCount);
    if (!contacts.length)
      throw new Error(
        schedule.type === "follow_up"
          ? "No due follow-up contacts found."
          : "No Ready contacts found.",
      );

    let batchCreatePromise: Promise<void> | null = null;
    const ensureBatchCreated = async () => {
      if (batchCreated) return;
      if (batchCreatePromise) return batchCreatePromise;
      batchCreatePromise = (async () => {
        const { error: batchError } = await supabase
          .from("outreach_batches")
          .insert({
            id: batchId,
            workspace_id: workspaceId,
            template_id: templates[0].id,
            requested_count: contacts.length,
            selected_sender_count: laneAccounts.length,
            status: dryRun ? "scheduled_dry_run" : "scheduled_running",
            raw: {
              schedule_id: scheduleId,
              schedule_type: schedule.type,
              schedule_raw: raw,
              parallel_sender_lanes: laneAccounts.length,
              sender_safety_modes: Object.fromEntries(laneAccounts.map((account) => [String(account.email), sendingMode(account)])),
              workspace_timezone: workspaceTimezone,
              max_emails_per_sender_this_run: Object.fromEntries(laneAccounts.map((account) => [String(account.email), requestedRunLimit(raw, account, senderRunLimitOverride)])),
            },
          });
        if (batchError) throw batchError;
        batchCreated = true;
      })();
      return batchCreatePromise;
    };

    const sentBySender: Record<string, number> = Object.fromEntries(
      laneAccounts.map((a) => [String(a.id), 0]),
    );
    const preparedAttachmentsByTemplate = new Map<string, Promise<EmailAttachment[]>>();
    const preparedAttachmentsFor = (template: AnyRow) => {
      const key = String(template.id || template.name || "template");
      const existing = preparedAttachmentsByTemplate.get(key);
      if (existing) return existing;
      const pending = prepareAttachments(templateAttachments(template));
      preparedAttachmentsByTemplate.set(key, pending);
      return pending;
    };

    let nextContactIndex = 0;
    let progressWrite = Promise.resolve();
    let lastProgressWriteCount = 0;
    const queueProgressWrite = (force = false) => {
      const currentCount = attempted + skipped;
      if (!force && currentCount - lastProgressWriteCount < 10) return progressWrite;
      lastProgressWriteCount = currentCount;
      const processedSnapshot = baseProcessed + attempted + skipped;
      const sentSnapshot = baseSent + sent;
      const failedSnapshot = baseFailed + failed;
      const skippedSnapshot = baseSkipped + skipped;
      progressWrite = progressWrite.then(async () => {
        await supabase
          .from("message_schedules")
          .update({
            processed_count: processedSnapshot,
            sent_count: sentSnapshot,
            failed_count: failedSnapshot,
            skipped_count: skippedSnapshot,
            last_heartbeat_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("workspace_id", workspaceId)
          .eq("id", scheduleId);
      });
      return progressWrite;
    };

    const takeNextContact = () => {
      if (stopped || nextContactIndex >= contacts.length) return null;
      const index = nextContactIndex;
      nextContactIndex += 1;
      return { business: contacts[index], index };
    };

    const runSenderLane = async (account: AnyRow) => {
      const accountId = String(account.id);
      const laneLease = await acquireSenderLaneLease(
        supabase,
        workspaceId,
        scheduleId,
        accountId,
      );
      if (!laneLease.allowed) return { attempted: 0, skipped: 0, reason: laneLease.reason || "capacity" };

      const startedAttempted = attempted;
      const startedSkipped = skipped;
      try {
        const laneCap = requestedRunLimit(raw, account, senderRunLimitOverride);
        const passCap = Math.max(
          1,
          Math.min(
            laneCap,
            sendingMode(account) === "fast" ? MAX_FAST_MESSAGES_PER_LANE_PASS : 1,
          ),
        );
        let laneAttempts = 0;
        let lastSendStartedAt = 0;

        // Stagger active lanes slightly. Idle connected accounts consume no worker slot.
        if (!dryRun) {
          await sleep(
            Math.min(
              2_000,
              Math.max(0, Number(laneLease.slot || 1) - 1) * 250,
            ),
          );
        }

        while (!stopped && laneAttempts < passCap) {
          await Promise.all([
            renewCampaignLease(supabase, campaignLeaseToken),
            renewSenderLaneLease(supabase, laneLease.token),
          ]);

          const control = await loadScheduleControl(
            supabase,
            workspaceId,
            scheduleId,
          );
          if (control.stopRequested) {
            stopped = true;
            break;
          }

          if (!dryRun) {
            const requiredDelay = pacingDelayByAccount.get(accountId) || nextDelayMs(account);
            const previousSendAt = lastSendStartedAt || (
              account.last_successful_send_at
                ? new Date(account.last_successful_send_at).getTime()
                : 0
            );
            const remainingDelay = previousSendAt
              ? requiredDelay - (Date.now() - previousSendAt)
              : 0;

            // Do not make a serverless request sleep for a long Warm-up/Normal
            // delay. The central worker will revisit this sender when it is due.
            if (remainingDelay > 1_500) break;
            if (remainingDelay > 0) await sleep(remainingDelay);
          }

          let reservation: SlotReservation | null = null;
          if (!dryRun) {
            reservation = await reserveSenderSlot(supabase, {
              workspaceId,
              account,
              scheduleId,
              batchId,
              timezone: workspaceTimezone,
              runLimit: laneCap,
            });
            if (!reservation.allowed) {
              // Capacity/allowance checks are expected while rotating many
              // senders. Do not create a database event on every worker tick.
              break;
            }
          }

          const task = takeNextContact();
          if (!task) {
            await finalizeSenderSlot(
              supabase,
              reservation?.reservationId || null,
              false,
              "No remaining contact in this pass.",
            );
            break;
          }
          const { business, index } = task;

          const teamGuard = await guardTeamBusinessForSend(
            supabase,
            workspaceId,
            String(business.id),
          );
          if (!teamGuard.allowed) {
            await finalizeSenderSlot(
              supabase,
              reservation?.reservationId || null,
              false,
              "Team duplicate protection blocked this contact.",
            );
            skipped += 1;
            await ensureBatchCreated();
            await supabase.from("outreach_events").insert({
              workspace_id: workspaceId,
              batch_id: batchId,
              business_id: business.id,
              type: "team_duplicate_blocked",
              message: `Blocked ${normalizeEmail(business.email)} because another team member owns the lead.`,
              raw: {
                schedule_id: scheduleId,
                owner_workspace_id: teamGuard.ownerWorkspaceId,
                conflict_key: teamGuard.conflictKey,
              },
            });
            await queueProgressWrite();
            continue;
          }

          attempted += 1;
          laneAttempts += 1;
          lastSendStartedAt = Date.now();
          await ensureBatchCreated();

          const template =
            templateMode === "specific"
              ? templates[0]
              : templates[index % templates.length];
          const localized = resolveTemplateContent(template, business);
          const subjects = splitSubjects(
            localized.subject,
            localized.subjectVariants,
          );
          const subject = renderTemplate(
            subjects[index % Math.max(1, subjects.length)] || localized.subject,
            business,
          );
          const body = renderTemplate(localized.message, business);
          const finalBody = appendSignatureToText(body, account);
          const toEmail = normalizeEmail(business.email);
          const nowIso = new Date().toISOString();

          try {
            const attachments = await preparedAttachmentsFor(template);
            let gmailMessageId = "";
            let gmailThreadId = "";
            if (!dryRun) {
              const accessToken = await ensureAccessToken(supabase, account);
              const result = await sendWithGmail(
                accessToken,
                String(account.email),
                toEmail,
                subject,
                body,
                account,
                attachments,
              );
              gmailMessageId = result.id || "";
              gmailThreadId = result.threadId || "";
            }

            const statusText = dryRun ? "dry_run" : "sent";
            const { error: sentHistoryError } = await supabase
              .from("sent_messages")
              .insert({
                workspace_id: workspaceId,
                business_id: business.id,
                template_id: template.id,
                gmail_account_id: account.id,
                batch_id: batchId,
                to_email: toEmail,
                from_email: normalizeEmail(account.email),
                subject,
                body: finalBody,
                provider_message_id: gmailMessageId || null,
                gmail_thread_id: gmailThreadId || null,
                status: statusText,
                delivery_status: statusText,
                is_follow_up: schedule.type === "follow_up",
                sent_at: nowIso,
                raw: {
                  schedule_id: scheduleId,
                  reservation_id: reservation?.reservationId || null,
                  dry_run: dryRun,
                  followup_segment:
                    raw.followup_segment || schedule.followup_segment || null,
                  signature_applied:
                    account.signature_enabled !== false &&
                    Boolean(account.signature_text || account.signature_html),
                  signature_application_count: 1,
                  sending_mode: sendingMode(account),
                  template_language: localized.language,
                  detected_business_language: localized.detectedLanguage,
                  used_language_fallback: localized.usedFallback,
                  attachments: templateAttachments(template).map((a: AnyRow) => ({
                    name: a.name || a.filename,
                    url: a.public_url || a.url,
                  })),
                },
              });

            if (!dryRun) {
              await finalizeSenderSlot(
                supabase,
                reservation?.reservationId || null,
                true,
                sentHistoryError?.message,
              );
              await supabase
                .from("businesses")
                .update({ status: "contacted", updated_at: nowIso })
                .eq("workspace_id", workspaceId)
                .eq("id", business.id);
              await supabase
                .from("gmail_accounts")
                .update({
                  sent_today: Number(account.sent_today || 0) + 1,
                  last_error: sentHistoryError
                    ? `Message sent but history save failed: ${sentHistoryError.message}`
                    : null,
                  last_successful_send_at: nowIso,
                  health_status:
                    account.health_status === "sender_limited"
                      ? "recovering"
                      : account.health_status,
                  updated_at: nowIso,
                })
                .eq("workspace_id", workspaceId)
                .eq("id", account.id);
              account.sent_today = Number(account.sent_today || 0) + 1;
              account.last_successful_send_at = nowIso;
              sentBySender[accountId] = (sentBySender[accountId] || 0) + 1;
              sent += 1;
            } else {
              skipped += 1;
            }

            await supabase.from("outreach_events").insert({
              workspace_id: workspaceId,
              batch_id: batchId,
              business_id: business.id,
              template_id: template.id,
              gmail_account_id: account.id,
              type: statusText,
              message:
                statusText === "sent"
                  ? `Message sent to ${toEmail}`
                  : `Scheduled ${statusText}: ${toEmail}`,
              raw: {
                schedule_id: scheduleId,
                business_name: business.name || "",
                from_email: normalizeEmail(account.email),
                to_email: toEmail,
                current: baseProcessed + attempted,
                target: totalTarget,
                sending_mode: sendingMode(account),
              },
            });
          } catch (sendError) {
            const err = sendError as Error & {
              status?: number;
              limitHit?: boolean;
              blocked?: boolean;
            };
            const reason = err.message || formatError(err);
            const failedStatus = err.blocked
              ? "message_blocked"
              : err.limitHit
                ? "limit_hit"
                : "failed";
            await finalizeSenderSlot(
              supabase,
              reservation?.reservationId || null,
              false,
              reason,
            );
            failed += 1;

            await supabase.from("sent_messages").insert({
              workspace_id: workspaceId,
              business_id: business.id,
              template_id: template.id,
              gmail_account_id: account.id,
              batch_id: batchId,
              to_email: toEmail,
              from_email: normalizeEmail(account.email),
              subject,
              body: finalBody,
              status: failedStatus,
              delivery_status: failedStatus,
              error_code: failedStatus,
              is_follow_up: schedule.type === "follow_up",
              sent_at: nowIso,
              raw: {
                schedule_id: scheduleId,
                error: reason,
                followup_segment:
                  raw.followup_segment || schedule.followup_segment || null,
                signature_applied:
                  account.signature_enabled !== false &&
                  Boolean(account.signature_text || account.signature_html),
                signature_application_count: 1,
                sending_mode: sendingMode(account),
                template_language: localized.language,
                detected_business_language: localized.detectedLanguage,
                used_language_fallback: localized.usedFallback,
                attachments: templateAttachments(template).map((a: AnyRow) => ({
                  name: a.name || a.filename,
                  url: a.public_url || a.url,
                })),
              },
            });
            await supabase.from("outreach_events").insert({
              workspace_id: workspaceId,
              batch_id: batchId,
              business_id: business.id,
              template_id: template.id,
              gmail_account_id: account.id,
              type: failedStatus,
              message: `${toEmail}: ${reason}`,
              raw: {
                schedule_id: scheduleId,
                business_name: business.name || "",
                from_email: normalizeEmail(account.email),
                to_email: toEmail,
                sending_mode: sendingMode(account),
              },
            });

            if (err.limitHit) {
              const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
              await pauseSenderForLimit(
                supabase,
                workspaceId,
                accountId,
                reason,
                until,
              );
              await queueProgressWrite();
              break;
            }
            if (err.blocked) {
              await supabase
                .from("gmail_accounts")
                .update({
                  spam_risk_status: "blocked_warning",
                  last_error: reason,
                  updated_at: new Date().toISOString(),
                })
                .eq("workspace_id", workspaceId)
                .eq("id", account.id);
            }
          }

          await queueProgressWrite();
        }

        return {
          attempted: attempted - startedAttempted,
          skipped: skipped - startedSkipped,
          reason: "",
        };
      } finally {
        await releaseSenderLaneLease(supabase, laneLease.token).catch(
          () => undefined,
        );
      }
    };

    // Try candidates in small waves until this workspace makes progress. This
    // skips capped/not-yet-due senders without activating more than the allowed
    // number of concurrent lanes.
    for (
      let index = 0;
      index < passCandidateAccounts.length && !stopped && nextContactIndex < contacts.length;
      index += MAX_ACTIVE_SENDER_LANES_PER_WORKSPACE
    ) {
      const wave = passCandidateAccounts.slice(
        index,
        index + MAX_ACTIVE_SENDER_LANES_PER_WORKSPACE,
      );
      const beforeProgress = attempted + skipped;
      await Promise.all(wave.map((account) => runSenderLane(account)));
      if (attempted + skipped > beforeProgress) break;
    }
    await queueProgressWrite(true);
    await progressWrite;

    if (stopped && nextContactIndex < contacts.length) {
      skipped += contacts.length - nextContactIndex;
    }

    if (!batchCreated && attempted === 0 && skipped === 0) {
      await supabase.from("message_schedules").update({
        status: "scheduled",
        scheduled_for: new Date(Date.now() + 30_000).toISOString(),
        last_error: "Waiting for sender capacity or a remaining sender allowance.",
        updated_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
      }).eq("workspace_id", workspaceId).eq("id", scheduleId);
      return {
        scheduleId,
        status: "queued",
        type: schedule.type,
        requested: contacts.length,
        attempted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        reason: "Waiting for sender capacity or allowance.",
      };
    }

    const totalProcessed = baseProcessed + attempted + skipped;
    const totalSent = baseSent + sent;
    const totalFailed = baseFailed + failed;
    const totalSkipped = baseSkipped + skipped;
    const shouldContinue = !stopped && totalProcessed < totalTarget && contacts.length > 0;
    const finalStatus = stopped ? "cancelled" : shouldContinue ? "scheduled" : "sent";

    if (batchCreated) {
      await supabase
        .from("outreach_batches")
        .update({
          status: dryRun
            ? "scheduled_dry_run_complete"
            : shouldContinue
              ? "scheduled_chunk_complete"
              : "scheduled_complete",
          attempted_count: attempted,
          sent_count: sent,
          failed_count: failed,
          skipped_count: skipped,
          finished_at: new Date().toISOString(),
          raw: {
            schedule_id: scheduleId,
            parallel_sender_lanes: laneAccounts.length,
            sender_safety_modes: Object.fromEntries(laneAccounts.map((laneAccount) => [String(laneAccount.email), sendingMode(laneAccount)])),
            sent_by_sender: sentBySender,
          },
        })
        .eq("workspace_id", workspaceId)
        .eq("id", batchId);
    }

    await supabase
      .from("message_schedules")
      .update({
        status: finalStatus,
        batch_id: batchCreated ? batchId : null,
        processed_count: totalProcessed,
        sent_count: totalSent,
        failed_count: totalFailed,
        skipped_count: totalSkipped,
        finished_at: shouldContinue ? null : new Date().toISOString(),
        stopped_at: stopped ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
        last_error: stopped
          ? "Stopped by user."
          : shouldContinue
            ? `Parallel chunk complete. ${Math.max(0, totalTarget - totalProcessed).toLocaleString()} left; the central worker will continue it safely.`
            : null,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", scheduleId);

    try {
      await createAppNotification(supabase as any, {
        workspaceId,
        type: shouldContinue ? "job_progress" : "job_completed",
        title: `${schedule.type === "follow_up" ? "Follow-up" : "Message"} job ${stopped ? "stopped" : shouldContinue ? "progress" : "completed"}`,
        message: shouldContinue
          ? `Sent ${totalSent.toLocaleString()} so far. ${Math.max(0, totalTarget - totalProcessed).toLocaleString()} left. ${laneAccounts.length} sender lane(s) are using their saved safety modes.`
          : `Sent ${totalSent.toLocaleString()}, failed ${totalFailed.toLocaleString()}, skipped ${totalSkipped.toLocaleString()}.`,
        entityType: "message_schedule",
        entityId: scheduleId,
        raw: {
          schedule_id: scheduleId,
          batch_id: batchId,
          attempted,
          sent,
          failed,
          skipped,
          total_processed: totalProcessed,
          total_sent: totalSent,
          total_target: totalTarget,
          should_continue: shouldContinue,
          parallel_sender_lanes: laneAccounts.length,
          sender_safety_modes: Object.fromEntries(laneAccounts.map((laneAccount) => [String(laneAccount.email), sendingMode(laneAccount)])),
          sent_by_sender: sentBySender,
        },
      });
    } catch {}

    return {
      scheduleId,
      status: shouldContinue ? "running" : stopped ? "skipped" : "sent",
      type: schedule.type,
      requested: contacts.length,
      attempted,
      sent,
      failed,
      skipped,
      batchId,
    };
  } catch (error) {
    const reason = formatError(error);
    await supabase
      .from("message_schedules")
      .update({
        status: "failed",
        last_error: reason,
        batch_id: batchId,
        processed_count: baseProcessed + attempted + skipped,
        sent_count: baseSent + sent,
        failed_count: baseFailed + failed,
        skipped_count: baseSkipped + skipped,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("id", scheduleId);
    if (batchCreated)
      await supabase
        .from("outreach_batches")
        .update({
          status: "scheduled_failed",
          attempted_count: attempted,
          sent_count: sent,
          failed_count: failed,
          skipped_count: skipped,
          finished_at: new Date().toISOString(),
          raw: {
            schedule_id: scheduleId,
            error: reason,
            followup_segment:
              raw.followup_segment || schedule.followup_segment || null,
          },
        })
        .eq("workspace_id", workspaceId)
        .eq("id", batchId);
    await createAppNotification(supabase as any, {
      workspaceId,
      type: "job_failed",
      title: `${schedule.type === "follow_up" ? "Follow-up" : "Message"} job failed`,
      message: reason,
      entityType: "message_schedule",
      entityId: scheduleId,
      raw: {
        schedule_id: scheduleId,
        batch_id: batchId,
        attempted,
        sent,
        failed,
        skipped,
        error: reason,
      },
    });
    return {
      scheduleId,
      status: "failed",
      type: schedule.type,
      requested: Math.max(1, Math.min(MAX_WORKER_BATCH_SIZE, requestedTarget)),
      attempted,
      sent,
      failed,
      skipped,
      reason,
      batchId,
    };
  } finally {
    await releaseCampaignLease(supabase, campaignLeaseToken).catch(() => undefined);
  }
}

async function resetStaleRunningSchedules(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const staleSince = new Date(Date.now() - 18 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("message_schedules")
    .update({
      status: "scheduled",
      last_error:
        "Resuming stale running job after a previous run stopped unexpectedly.",
      resume_count: 1,
      updated_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .or("stop_requested.is.null,stop_requested.eq.false")
    .is("finished_at", null)
    .lt("updated_at", staleSince);
  if (error) throw error;
}

async function runSchedules(
  limit = MAX_SCHEDULES_PER_RUN,
  scheduleId?: string,
  targetLimitOverride?: number,
  senderRunLimitOverride?: number,
  workspaceId?: string,
) {
  const supabase = createAdminClient();
  await resetStaleRunningSchedules(supabase);
  let query = supabase
    .from("message_schedules")
    .select("*")
    .eq("status", "scheduled")
    .or("stop_requested.is.null,stop_requested.eq.false")
    .lte("scheduled_for", new Date().toISOString())
    .order("updated_at", { ascending: true })
    .order("scheduled_for", { ascending: true })
    .limit(Math.max(1, Math.min(MAX_SCHEDULES_PER_RUN, limit)));
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  if (scheduleId) query = query.eq("id", scheduleId);
  const { data: schedules, error } = await query;
  if (error) throw error;
  // Run different workspaces concurrently. Database campaign/sender leases
  // enforce the platform-wide and per-workspace limits across all instances.
  return Promise.all(
    (schedules || []).map((schedule) =>
      runOneSchedule(
        supabase,
        schedule,
        targetLimitOverride,
        senderRunLimitOverride,
      ),
    ),
  );
}

async function isAuthorizedWorkerRequest(
  request: NextRequest,
  input?: Record<string, unknown>,
) {
  const provided = scheduleWorkerSecretFromRequest(request, input);
  const configuredSecrets = [
    process.env.SCHEDULE_WORKER_SECRET,
    process.env.CRON_SECRET,
    process.env.RUN_ALL_WORKER_SECRET,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (provided && configuredSecrets.includes(provided)) {
    return { allowed: true, worker: true, workspaceId: "" };
  }

  // A signed-in user may manually process only their own workspace. This keeps
  // the existing "Run due sends" button without exposing a platform worker.
  const requestedWorkspace = String(
    input?.workspaceId || request.nextUrl.searchParams.get("workspaceId") || "",
  ).trim();
  if (!requestedWorkspace) {
    return { allowed: false, worker: false, workspaceId: "" };
  }
  try {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return { allowed: false, worker: false, workspaceId: "" };
    const { data: membership } = await userClient
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", requestedWorkspace)
      .eq("user_id", user.id)
      .eq("approved", true)
      .maybeSingle();
    return {
      allowed: Boolean(membership),
      worker: false,
      workspaceId: membership ? requestedWorkspace : "",
    };
  } catch {
    return { allowed: false, worker: false, workspaceId: "" };
  }
}

export async function GET(request: NextRequest) {
  try {
    const authorization = await isAuthorizedWorkerRequest(request);
    if (!authorization.allowed) {
      return NextResponse.json(
        { success: false, error: "Unauthorized schedule worker request." },
        { status: 401 },
      );
    }
    const limit = Number(
      request.nextUrl.searchParams.get("limit") || MAX_SCHEDULES_PER_RUN,
    );
    const scheduleId = String(
      request.nextUrl.searchParams.get("scheduleId") || "",
    );
    const targetLimit = Number(request.nextUrl.searchParams.get("targetLimit") || request.nextUrl.searchParams.get("scheduleBatchSize") || 0);
    const senderRunLimit = Number(request.nextUrl.searchParams.get("senderRunLimit") || 0);
    const requestedWorkspaceId = String(request.nextUrl.searchParams.get("workspaceId") || "");
    const workspaceId = authorization.worker
      ? requestedWorkspaceId
      : authorization.workspaceId;
    const results = await runSchedules(limit, scheduleId || undefined, targetLimit || undefined, senderRunLimit || undefined, workspaceId || undefined);
    return NextResponse.json({ success: true, ran: results.length, results });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: formatError(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json().catch(() => ({}));
    const authorization = await isAuthorizedWorkerRequest(request, input);
    if (!authorization.allowed) {
      return NextResponse.json(
        { success: false, error: "Unauthorized schedule worker request." },
        { status: 401 },
      );
    }
    const results = await runSchedules(
      Number(input.limit || MAX_SCHEDULES_PER_RUN),
      input.scheduleId ? String(input.scheduleId) : undefined,
      Number(input.targetLimit || input.scheduleBatchSize || 0) || undefined,
      Number(input.senderRunLimit || 0) || undefined,
      authorization.worker
        ? (input.workspaceId ? String(input.workspaceId) : undefined)
        : authorization.workspaceId,
    );
    return NextResponse.json({ success: true, ran: results.length, results });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: formatError(error) },
      { status: 500 },
    );
  }
}
