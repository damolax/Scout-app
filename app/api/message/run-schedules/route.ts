export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { analyzeSpamRisk } from "@/lib/spam-guard";
import { createAppNotification } from "@/lib/notifications";
import { buildMimeMessage, appendSignatureToText } from "@/lib/email-signature";

type AnyRow = Record<string, any>;

type WorkerSummary = {
  scheduleId: string;
  status: "sent" | "failed" | "skipped" | "running";
  type?: string;
  requested: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  reason?: string;
  batchId?: string;
};

const MAX_WORKER_BATCH_SIZE = 2000;
const MAX_SCHEDULES_PER_RUN = 25;

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
    text.includes("limit exceeded")
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

function senderCap(scheduleRaw: AnyRow, account: AnyRow, senderRunLimitOverride?: number) {
  const caps = scheduleRaw?.sender_run_limits || {};
  const byEmail = caps[String(account.email || "")];
  const byId = caps[String(account.id || "")];
  const raw = senderRunLimitOverride && senderRunLimitOverride > 0 ? senderRunLimitOverride : byId ?? byEmail;
  let runLimit = Number.POSITIVE_INFINITY;
  if (
    raw !== undefined &&
    raw !== null &&
    String(raw).trim() !== "" &&
    String(raw).toLowerCase() !== "auto"
  ) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) runLimit = Math.floor(parsed);
  } else {
    const defaultLimit = Number(
      account.default_run_limit || account.daily_limit || 0,
    );
    runLimit = Number.isFinite(defaultLimit) && defaultLimit > 0
      ? Math.floor(defaultLimit)
      : Number.POSITIVE_INFINITY;
  }
  const dailyLimit = Number(account.daily_limit || 0);
  const alreadySent = Number(account.sent_today || 0);
  if (Number.isFinite(dailyLimit) && dailyLimit > 0) {
    const remainingToday = Math.max(0, Math.floor(dailyLimit - alreadySent));
    return Math.max(0, Math.min(runLimit, remainingToday));
  }
  return runLimit;
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
) {
  const message = buildMimeMessage({ from, to, subject, body, identity });
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
  const selectedIds = Array.isArray(raw.selected_sender_ids)
    ? raw.selected_sender_ids.map(String).filter(Boolean)
    : [];
  let query = supabase
    .from("gmail_accounts")
    .select("*")
    .eq("workspace_id", schedule.workspace_id)
    .in("status", ["connected", "ready"]);
  if (selectedIds.length) query = query.in("id", selectedIds);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).filter(
    (account) =>
      !isPaused(account) && (account.access_token || account.refresh_token),
  );
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
  const audienceCategoryId = String(
    schedule.audience_category_id || raw.audience_category_id || "",
  ).trim();

  let query = supabase
    .from("businesses")
    .select("*")
    .eq("workspace_id", schedule.workspace_id)
    .eq("status", "ready")
    .not("email", "is", null)
    .neq("email", "")
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (selectedIds.length) query = query.in("id", selectedIds);
  if (audienceCategoryId) query = query.eq("category_id", audienceCategoryId);
  else if (cleanCategory) query = query.ilike("category", `%${cleanCategory}%`);
  if (cleanSearch)
    query = query.or(
      `name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,domain.ilike.%${cleanSearch}%,website.ilike.%${cleanSearch}%`,
    );

  const { data, error } = await query;
  if (error) throw error;
  const unique = new Map<string, AnyRow>();
  for (const row of data || []) {
    const email = normalizeEmail(row.email);
    if (email && !unique.has(email)) unique.set(email, row);
  }
  return Array.from(unique.values()).slice(0, limit);
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
  return ids.map((id: string) => byId.get(id)).filter(Boolean);
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
  const requestedTarget = targetLimitOverride && targetLimitOverride > 0 ? targetLimitOverride : Number(schedule.target_count || 100);
  const targetCount = Math.max(
    1,
    Math.min(MAX_WORKER_BATCH_SIZE, requestedTarget),
  );
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
      requested: targetCount,
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      reason: "Already running or not scheduled.",
    };

  const batchId = `schedule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let stopped = false;

  try {
    const templates = await loadTemplates(supabase, schedule);
    if (!templates.length)
      throw new Error("No active template found for this schedule.");
    const accounts = await loadAccounts(supabase, schedule);
    if (!accounts.length)
      throw new Error("No connected sender available for this schedule.");
    const templateMode = String(
      raw.template_mode || (schedule.template_id ? "specific" : "rotate"),
    );
    const senderMode = String(raw.sender_mode || "rotate");
    const allowHighRiskSend = Boolean(raw.allow_high_risk_send);
    const dryRun = Boolean(raw.dry_run);
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
    const sampleSubject = renderTemplate(
      splitSubjects(
        String(sampleTemplate.subject || ""),
        sampleTemplate.subject_variants,
      )[0] || String(sampleTemplate.subject || ""),
      sampleBusiness,
    );
    const sampleBody = renderTemplate(
      String(sampleTemplate.message || ""),
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

    const { error: batchError } = await supabase
      .from("outreach_batches")
      .insert({
        id: batchId,
        workspace_id: workspaceId,
        template_id: templates[0].id,
        requested_count: contacts.length,
        selected_sender_count: accounts.length,
        status: dryRun ? "scheduled_dry_run" : "scheduled_running",
        raw: {
          schedule_id: scheduleId,
          schedule_type: schedule.type,
          schedule_raw: raw,
        },
      });
    if (batchError) throw batchError;

    const sentBySender: Record<string, number> = Object.fromEntries(
      accounts.map((a) => [String(a.id), 0]),
    );
    let activeAccounts = [...accounts];
    let cursor = 0;

    for (let i = 0; i < contacts.length; i++) {
      const control = await loadScheduleControl(supabase, workspaceId, scheduleId);
      if (control.stopRequested) {
        stopped = true;
        skipped += contacts.length - i;
        break;
      }
      const business = contacts[i];
      const eligibleAccounts = activeAccounts.filter(
        (account) => (sentBySender[account.id] || 0) < senderCap(raw, account, senderRunLimitOverride),
      );
      if (!eligibleAccounts.length) {
        skipped += contacts.length - i;
        break;
      }
      const account =
        senderMode === "specific"
          ? eligibleAccounts[0]
          : eligibleAccounts[cursor % eligibleAccounts.length];
      const template =
        templateMode === "specific"
          ? templates[0]
          : templates[i % templates.length];
      cursor += 1;
      attempted += 1;
      const subjects = splitSubjects(
        String(template.subject || ""),
        template.subject_variants,
      );
      const subject = renderTemplate(
        subjects[i % Math.max(1, subjects.length)] ||
          String(template.subject || ""),
        business,
      );
      const body = renderTemplate(String(template.message || ""), business);
      const finalBody = appendSignatureToText(body, account);
      const toEmail = normalizeEmail(business.email);
      const nowIso = new Date().toISOString();

      try {
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
          );
          gmailMessageId = result.id || "";
          gmailThreadId = result.threadId || "";
        }
        const statusText = dryRun ? "dry_run" : "sent";
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
          provider_message_id: gmailMessageId || null,
          gmail_thread_id: gmailThreadId || null,
          status: statusText,
          delivery_status: statusText,
          is_follow_up: schedule.type === "follow_up",
          sent_at: nowIso,
          raw: {
            schedule_id: scheduleId,
            dry_run: dryRun,
            followup_segment:
              raw.followup_segment || schedule.followup_segment || null,
            signature_applied:
              account.signature_enabled !== false &&
              Boolean(account.signature_text || account.signature_html),
          },
        });
        if (!dryRun) {
          await supabase
            .from("businesses")
            .update({
              status: schedule.type === "follow_up" ? "contacted" : "contacted",
              updated_at: nowIso,
            })
            .eq("workspace_id", workspaceId)
            .eq("id", business.id);
          await supabase
            .from("gmail_accounts")
            .update({
              sent_today: Number(account.sent_today || 0) + 1,
              last_error: null,
              updated_at: nowIso,
            })
            .eq("workspace_id", workspaceId)
            .eq("id", account.id);
          account.sent_today = Number(account.sent_today || 0) + 1;
          sentBySender[account.id] = (sentBySender[account.id] || 0) + 1;
          sent += 1;
        } else {
          skipped += 1;
        }
        await supabase
          .from("outreach_events")
          .insert({
            workspace_id: workspaceId,
            batch_id: batchId,
            business_id: business.id,
            template_id: template.id,
            gmail_account_id: account.id,
            type: statusText,
            message: `Scheduled ${statusText}: ${toEmail}`,
            raw: { schedule_id: scheduleId },
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
          },
        });
        await supabase
          .from("outreach_events")
          .insert({
            workspace_id: workspaceId,
            batch_id: batchId,
            business_id: business.id,
            template_id: template.id,
            gmail_account_id: account.id,
            type: failedStatus,
            message: reason,
            raw: { schedule_id: scheduleId },
          });
        if (err.limitHit) {
          const until = new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString();
          await supabase
            .from("gmail_accounts")
            .update({
              status: "limit_hit",
              paused_until: until,
              last_error: reason,
              updated_at: new Date().toISOString(),
            })
            .eq("workspace_id", workspaceId)
            .eq("id", account.id);
          activeAccounts = activeAccounts.filter((a) => a.id !== account.id);
        } else if (err.blocked) {
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
      await supabase
        .from("message_schedules")
        .update({
          processed_count: attempted,
          sent_count: sent,
          failed_count: failed,
          skipped_count: skipped,
          last_heartbeat_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", workspaceId)
        .eq("id", scheduleId);
    }

    const finalStatus = stopped ? "cancelled" : dryRun ? "sent" : "sent";
    await supabase
      .from("outreach_batches")
      .update({
        status: dryRun ? "scheduled_dry_run_complete" : "scheduled_complete",
        attempted_count: attempted,
        sent_count: sent,
        failed_count: failed,
        skipped_count: skipped,
        finished_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("id", batchId);
    await supabase
      .from("message_schedules")
      .update({
        status: finalStatus,
        batch_id: batchId,
        processed_count: attempted,
        sent_count: sent,
        failed_count: failed,
        skipped_count: skipped,
        finished_at: new Date().toISOString(),
        stopped_at: stopped ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
        last_error: stopped ? "Stopped by user." : null,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", scheduleId);
    await createAppNotification(supabase as any, {
      workspaceId,
      type: "job_completed",
      title: `${schedule.type === "follow_up" ? "Follow-up" : "Message"} job ${stopped ? "stopped" : "completed"}`,
      message: `Sent ${sent.toLocaleString()}, failed ${failed.toLocaleString()}, skipped ${skipped.toLocaleString()}.`,
      entityType: "message_schedule",
      entityId: scheduleId,
      raw: {
        schedule_id: scheduleId,
        batch_id: batchId,
        attempted,
        sent,
        failed,
        skipped,
      },
    });
    return {
      scheduleId,
      status: stopped ? "skipped" : "sent",
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
        processed_count: attempted,
        sent_count: sent,
        failed_count: failed,
        skipped_count: skipped,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("id", scheduleId);
    if (batchId)
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
      requested: targetCount,
      attempted,
      sent,
      failed,
      skipped,
      reason,
      batchId,
    };
  }
}

async function resetStaleRunningSchedules(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const staleSince = new Date(Date.now() - 12 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("message_schedules")
    .update({
      status: "scheduled",
      last_error:
        "Resuming stale running job after worker timeout or page close.",
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
) {
  const supabase = createAdminClient();
  await resetStaleRunningSchedules(supabase);
  let query = supabase
    .from("message_schedules")
    .select("*")
    .eq("status", "scheduled")
    .or("stop_requested.is.null,stop_requested.eq.false")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(Math.max(1, Math.min(MAX_SCHEDULES_PER_RUN, limit)));
  if (scheduleId) query = query.eq("id", scheduleId);
  const { data: schedules, error } = await query;
  if (error) throw error;
  const results: WorkerSummary[] = [];
  for (const schedule of schedules || []) {
    results.push(await runOneSchedule(supabase, schedule, targetLimitOverride, senderRunLimitOverride));
  }
  return results;
}

export async function GET(request: NextRequest) {
  try {
    const secret =
      process.env.SCHEDULE_WORKER_SECRET || process.env.CRON_SECRET || "";
    const provided = scheduleWorkerSecretFromRequest(request);
    if (secret && provided !== secret) {
      return NextResponse.json(
        { success: false, error: "Invalid schedule worker token." },
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
    const results = await runSchedules(limit, scheduleId || undefined, targetLimit || undefined, senderRunLimit || undefined);
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
    const secret =
      process.env.SCHEDULE_WORKER_SECRET || process.env.CRON_SECRET || "";
    const provided = scheduleWorkerSecretFromRequest(request, input);
    if (secret && provided !== secret) {
      return NextResponse.json(
        { success: false, error: "Invalid schedule worker token." },
        { status: 401 },
      );
    }
    const results = await runSchedules(
      Number(input.limit || MAX_SCHEDULES_PER_RUN),
      input.scheduleId ? String(input.scheduleId) : undefined,
      Number(input.targetLimit || input.scheduleBatchSize || 0) || undefined,
      Number(input.senderRunLimit || 0) || undefined,
    );
    return NextResponse.json({ success: true, ran: results.length, results });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: formatError(error) },
      { status: 500 },
    );
  }
}
