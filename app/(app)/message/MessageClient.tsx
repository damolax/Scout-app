"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { analyzeSpamRisk } from "@/lib/spam-guard";
import { emitLiveActivity } from "@/lib/live-activity-client";
import {
  Business,
  GmailAccount,
  MessageCategory,
  MessageSchedule,
  MessageTemplate,
  Workspace,
} from "@/lib/types";

type SendLogRow = {
  id: string;
  status?: string | null;
  to_email?: string | null;
  from_email?: string | null;
  subject?: string | null;
  sent_at?: string | null;
};

type DueFollowUp = {
  business_id: string;
  business_name: string | null;
  to_email: string;
  last_sent_at: string;
  last_subject: string | null;
  template_id: string | null;
  gmail_account_id: string | null;
  followup_segment?: string | null;
  segment?: string | null;
  reply_state?: string | null;
  last_auto_reply_at?: string | null;
};

type LocationOption = {
  value: string;
  label: string;
  count: number;
};

type SendResult = {
  id?: string;
  email?: string;
  status?: string;
  subject?: string;
  reason?: string;
  code?: string;
  stopBatch?: boolean;
  gmailMessageId?: string;
  gmailThreadId?: string;
  pausedUntil?: string;
  [key: string]: unknown;
};

type Summary = {
  requested: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  stopped: boolean;
};
type TemplateMode = "specific" | "rotate";
type SenderMode = "specific" | "rotate";
type MessageKind = "initial" | "follow_up";

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

const READY_PAGE_SIZE = 100;
const MAX_MESSAGE_BATCH_SIZE = 50000;
const SHORTCODES = [
  "{name}",
  "{business}",
  "{company}",
  "{email}",
  "{website}",
  "{domain}",
  "{phone}",
  "{category}",
  "{industry}",
  "{location}",
  "{source}",
];

function formatError(error: unknown) {
  if (!error) return "Unknown error.";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    const item = error as {
      message?: string;
      code?: string;
      details?: string;
      hint?: string;
      error?: string;
      reason?: string;
    };
    return (
      [
        item.message || item.error,
        item.reason,
        item.code ? `Code: ${item.code}` : "",
        item.details,
        item.hint,
      ]
        .filter(Boolean)
        .join(" | ") || JSON.stringify(error)
    );
  } catch {
    return String(error);
  }
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

function extractBusinessLocations(business: Partial<Business>) {
  const values = new Set<string>();
  addLocationCandidate(values, business.location);
  const raw = business.raw && typeof business.raw === "object" ? business.raw : {};
  for (const key of LOCATION_RAW_KEYS) {
    const direct = (raw as Record<string, unknown>)[key];
    if (Array.isArray(direct)) direct.forEach((item) => addLocationCandidate(values, item));
    else addLocationCandidate(values, direct);
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("location") ||
      normalizedKey.includes("country") ||
      normalizedKey.includes("market") ||
      normalizedKey.includes("city") ||
      normalizedKey.includes("region") ||
      normalizedKey.includes("state") ||
      normalizedKey.includes("address") ||
      normalizedKey.includes("territory")
    ) {
      if (Array.isArray(value)) value.forEach((item) => addLocationCandidate(values, item));
      else addLocationCandidate(values, value);
    }
  }
  return Array.from(values);
}

function businessMatchesLocation(business: Business, selectedLocation: string) {
  const selected = cleanLocationValue(selectedLocation).toLowerCase();
  if (!selected) return true;
  return extractBusinessLocations(business).some(
    (item) => item.toLowerCase() === selected,
  );
}

function applyLocationFilter(rows: Business[], selectedLocation: string) {
  const selected = cleanLocationValue(selectedLocation);
  if (!selected) return rows;
  return rows.filter((business) => businessMatchesLocation(business, selected));
}

function contactableStatusQuery(query: any) {
  return query.in("status", CONTACTABLE_BUSINESS_STATUSES);
}

function isMissingReadyContactIssue(error: unknown) {
  const text = formatError(error).toLowerCase();
  return text.includes("no ready to contact") || text.includes("ready to contact with email");
}

function isMissingRpcFunction(error: unknown) {
  const text = formatError(error).toLowerCase();
  return (
    text.includes("pgrst202") ||
    text.includes("get_due_followups") ||
    text.includes("schema cache")
  );
}

function splitSubjects(subject: string, variants?: string[] | null) {
  const all = [subject, ...(variants || [])]
    .flatMap((item) => String(item || "").split("\n"))
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(all));
}

function getDomain(business: Business) {
  if (business.domain) return business.domain;
  try {
    if (business.website)
      return new URL(
        business.website.startsWith("http")
          ? business.website
          : `https://${business.website}`,
      ).hostname.replace(/^www\./, "");
  } catch {}
  return String(business.email || "").split("@")[1] || "";
}

function renderTemplate(text: string, business: Business) {
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
  return text.replace(
    /\{([a-zA-Z0-9_]+)\}/g,
    (_match, key) => values[String(key).toLowerCase()] ?? "",
  );
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(name: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  const lines = [headers.join(",")];
  for (const row of rows)
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isPaused(account: GmailAccount) {
  if (!account.paused_until) return false;
  return new Date(account.paused_until).getTime() > Date.now();
}

function isLimitPayload(json: any, result?: SendResult) {
  const code = String(
    json?.code ||
      json?.reason ||
      json?.stopReason ||
      result?.code ||
      result?.reason ||
      "",
  ).toLowerCase();
  const message = String(
    json?.error || json?.message || result?.reason || "",
  ).toLowerCase();
  return (
    json?.forceStopped ||
    result?.stopBatch ||
    code.includes("limit") ||
    message.includes("limit reached") ||
    message.includes("sending limit") ||
    message.includes("quota")
  );
}

function isBlockedPayload(json: any, result?: SendResult) {
  const text = [
    json?.error,
    json?.message,
    json?.code,
    result?.status,
    result?.reason,
    result?.code,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    text.includes("message blocked") ||
    text.includes("blocked") ||
    text.includes("policy") ||
    text.includes("spam") ||
    text.includes("rejected")
  );
}

function toDateTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 5, 0, 0);
  return d.toISOString();
}

function asLocalDateTimeValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inHours(hours: number) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return asLocalDateTimeValue(d);
}

export default function MessageClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<MessageCategory[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [readyContacts, setReadyContacts] = useState<Business[]>([]);
  const [readyTotal, setReadyTotal] = useState(0);
  const [recentSent, setRecentSent] = useState<SendLogRow[]>([]);
  const [dueFollowUps, setDueFollowUps] = useState<DueFollowUp[]>([]);
  const [schedules, setSchedules] = useState<MessageSchedule[]>([]);
  const [locationOptions, setLocationOptions] = useState<LocationOption[]>([]);

  const [selectedContacts, setSelectedContacts] = useState<
    Record<string, boolean>
  >({});
  const [selectedAccounts, setSelectedAccounts] = useState<
    Record<string, boolean>
  >({});
  const [senderRunLimits, setSenderRunLimits] = useState<
    Record<string, string>
  >({});
  const [senderLast24h, setSenderLast24h] = useState<Record<string, number>>(
    {},
  );
  const [specificSenderId, setSpecificSenderId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templateMode, setTemplateMode] = useState<TemplateMode>("specific");
  const [senderMode, setSenderMode] = useState<SenderMode>("rotate");
  const [businessCategoryFilter, setBusinessCategoryFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [audienceCategoryId, setAudienceCategoryId] = useState(
    workspace.default_audience_category_id || "",
  );
  const [readySearch, setReadySearch] = useState("");
  const [sendLimit, setSendLimit] = useState(1000);
  const [delayMs, setDelayMs] = useState(0);
  const [dryRun, setDryRun] = useState(false);
  const [allowHighRiskSend, setAllowHighRiskSend] = useState(false);
  const [scheduleType, setScheduleType] = useState<"initial" | "follow_up">(
    "initial",
  );
  const [scheduleFor, setScheduleFor] = useState(inHours(1));
  const [scheduleCount, setScheduleCount] = useState(1000);
  const [followUpFor, setFollowUpFor] = useState(inHours(2));
  const [followUpSegment, setFollowUpSegment] = useState<
    "all_unanswered" | "no_reply" | "auto_reply"
  >("all_unanswered");

  const [status, setStatus] = useState(
    "Select category, template option, sender option, total count, and optional per-sender caps.",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopBusyId, setStopBusyId] = useState("");
  const [autoRunSchedules, setAutoRunSchedules] = useState(true);
  const [scheduleRunnerBusy, setScheduleRunnerBusy] = useState(false);
  const scheduleRunnerRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastResults, setLastResults] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [summary, setSummary] = useState<Summary>({
    requested: 0,
    attempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    stopped: false,
  });

  const selectedContactIds = Object.keys(selectedContacts).filter(
    (id) => selectedContacts[id],
  );
  const selectedAccountIds = Object.keys(selectedAccounts).filter(
    (id) => selectedAccounts[id],
  );
  const sendableTemplates = templates.filter(
    (t) => (t.template_type || "initial") !== "reply",
  );
  const categoryTemplates = sendableTemplates.filter(
    (t) => !categoryId || t.category_id === categoryId,
  );
  const currentTemplate =
    templates.find((t) => t.id === templateId) ||
    categoryTemplates[0] ||
    templates[0];
  const selectedAudienceCategory =
    categories.find((c) => c.id === audienceCategoryId) || null;
  const connectedAccounts = accounts.filter(
    (a) =>
      ["connected", "ready"].includes(String(a.status || "")) &&
      !isPaused(a) &&
      (a.access_token || a.refresh_token),
  );
  const previewBusiness =
    readyContacts.find((b) => selectedContacts[b.id]) || readyContacts[0];
  const previewSubject =
    previewBusiness && currentTemplate
      ? renderTemplate(
          splitSubjects(
            currentTemplate.subject,
            currentTemplate.subject_variants,
          )[0] || currentTemplate.subject,
          previewBusiness,
        )
      : "";
  const previewBody =
    previewBusiness && currentTemplate
      ? renderTemplate(currentTemplate.message, previewBusiness)
      : "";
  const spamReport = analyzeSpamRisk(previewSubject, previewBody);

  async function loadCategories() {
    const { data, error: loadError } = await supabase
      .from("message_categories")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("active", true)
      .order("name", { ascending: true });
    if (loadError) throw loadError;
    const rows = (data || []) as MessageCategory[];
    setCategories(rows);
    if (!categoryId && rows[0]?.id) setCategoryId(rows[0].id);
  }

  async function loadTemplates() {
    const { data, error: loadError } = await supabase
      .from("templates")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (loadError) throw loadError;
    const rows = ((data || []) as MessageTemplate[]).filter(
      (t) => (t.template_type || "initial") !== "reply",
    );
    setTemplates(rows);
    if (!templateId && rows[0]?.id) setTemplateId(rows[0].id);
  }

  async function loadAccounts() {
    const { data, error: loadError } = await supabase
      .from("gmail_accounts")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false });
    if (loadError) throw loadError;
    const rows = (data || []) as GmailAccount[];
    setAccounts(rows);
    setSelectedAccounts((current) => {
      const next: Record<string, boolean> = {};
      for (const account of rows)
        next[account.id] =
          current[account.id] ??
          (["connected", "ready"].includes(String(account.status || "")) &&
            !isPaused(account));
      return next;
    });
    if (!specificSenderId && rows[0]?.id) setSpecificSenderId(rows[0].id);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const counts: Record<string, number> = {};
    await Promise.all(
      rows.map(async (account) => {
        const email = normalizeEmail(account.email);
        if (!email) return;
        const { count } = await supabase
          .from("sent_messages")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspace.id)
          .eq("status", "sent")
          .eq("from_email", account.email)
          .gte("sent_at", since);
        counts[account.id] = count || 0;
      }),
    );
    setSenderLast24h(counts);
  }

  async function loadAvailableLocations() {
    let query = contactableStatusQuery(
      supabase
        .from("businesses")
        .select("id,location,raw,category,category_id,email,status,updated_at")
        .eq("workspace_id", workspace.id)
        .not("email", "is", null)
        .neq("email", "")
        .order("updated_at", { ascending: false })
        .range(0, 19999),
    );

    if (audienceCategoryId) query = query.eq("category_id", audienceCategoryId);
    else {
      const cleanCategory = businessCategoryFilter.trim().replace(/[%_]/g, "");
      if (cleanCategory) query = query.ilike("category", `%${cleanCategory}%`);
    }

    const { data, error: locationError } = await query;
    if (locationError) throw locationError;

    const counts = new Map<string, number>();
    for (const row of (data || []) as Business[]) {
      for (const value of extractBusinessLocations(row)) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }

    const options = Array.from(counts.entries())
      .map(([value, count]) => ({ value, count, label: `${value} (${count.toLocaleString()})` }))
      .sort((a, b) => a.value.localeCompare(b.value));

    setLocationOptions(options);
    setCountryFilter((current) =>
      current && !options.some((option) => option.value === current) ? "" : current,
    );
  }

  async function loadReadyContacts() {
    const cleanSearch = readySearch.trim().replace(/[%_]/g, "");
    const cleanCategory = businessCategoryFilter.trim().replace(/[%_]/g, "");
    const cleanCountry = countryFilter.trim().replace(/[%_]/g, "");
    const targetBusinessId =
      typeof window !== "undefined"
        ? new URL(window.location.href).searchParams.get("business")
        : "";
    const pageLimit = cleanCountry ? 10000 : READY_PAGE_SIZE;
    let query = contactableStatusQuery(
      supabase
        .from("businesses")
        .select("*", { count: "exact" })
        .eq("workspace_id", workspace.id)
        .not("email", "is", null)
        .neq("email", "")
        .order("updated_at", { ascending: true })
        .limit(pageLimit),
    );
    if (cleanSearch)
      query = query.or(
        `name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,domain.ilike.%${cleanSearch}%,website.ilike.%${cleanSearch}%`,
      );
    if (audienceCategoryId) query = query.eq("category_id", audienceCategoryId);
    else if (cleanCategory)
      query = query.ilike("category", `%${cleanCategory}%`);
    const { data, error: loadError, count } = await query;
    if (loadError) throw loadError;
    let allRows = applyLocationFilter((data || []) as Business[], cleanCountry);
    let rows = allRows.slice(0, READY_PAGE_SIZE);
    let selected: Record<string, boolean> = {};
    if (targetBusinessId) {
      const { data: target, error: targetError } = await supabase
        .from("businesses")
        .select("*")
        .eq("workspace_id", workspace.id)
        .eq("id", targetBusinessId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (target?.email) {
        rows = [
          target as Business,
          ...rows.filter((b) => b.id !== target.id),
        ].slice(0, READY_PAGE_SIZE);
        selected = { [target.id]: true };
        setStatus(`Loaded selected business: ${target.name || target.email}.`);
      }
    }
    setReadyContacts(rows);
    setReadyTotal(cleanCountry ? allRows.length : count || rows.length);
    setSelectedContacts(selected);
    if (!rows.length && cleanCountry) {
      setStatus(`No contactable emails matched ${cleanCountry}. Try All available locations or run Repair Ready Contacts.`);
    }
  }

  async function loadRecentSent() {
    const { data } = await supabase
      .from("sent_messages")
      .select("id,status,to_email,from_email,subject,sent_at")
      .eq("workspace_id", workspace.id)
      .order("sent_at", { ascending: false })
      .limit(80);
    setRecentSent((data || []) as SendLogRow[]);
  }

  async function fetchDueFollowUps(limitRows = 100) {
    const { data, error: dueError } = await supabase.rpc("get_due_followups", {
      target_workspace: workspace.id,
      limit_rows: limitRows,
      followup_segment: followUpSegment,
    });
    if (dueError) {
      if (isMissingRpcFunction(dueError)) {
        setStatus(
          "Follow-up RPC is missing in Supabase. Run the v8.39 Supabase SQL once; the rest of Message page will still load.",
        );
        return [];
      }
      throw dueError;
    }
    return (data || []) as DueFollowUp[];
  }

  async function loadDueFollowUps() {
    setDueFollowUps(await fetchDueFollowUps(100));
  }

  async function loadSchedules() {
    const { data, error: scheduleError } = await supabase
      .from("message_schedules")
      .select("*")
      .eq("workspace_id", workspace.id)
      .in("status", ["scheduled", "due", "running"])
      .order("scheduled_for", { ascending: true })
      .limit(50);
    if (scheduleError) throw scheduleError;
    setSchedules((data || []) as MessageSchedule[]);
  }

  async function refreshAll() {
    setLoading(true);
    setError("");
    try {
      await Promise.all([
        loadCategories(),
        loadTemplates(),
        loadAccounts(),
        loadAvailableLocations(),
        loadReadyContacts(),
        loadRecentSent(),
        loadDueFollowUps(),
        loadSchedules(),
      ]);
      setStatus("Loaded Message workspace.");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  useEffect(() => {
    if (!workspace.id) return;
    loadAvailableLocations().catch((err) => setError(formatError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, audienceCategoryId, businessCategoryFilter]);

  useEffect(() => {
    const first =
      templates.find((t) => t.category_id === categoryId) || templates[0];
    if (
      first &&
      !templates.some(
        (t) =>
          t.id === templateId && (!categoryId || t.category_id === categoryId),
      )
    )
      setTemplateId(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, templates.length]);

  useEffect(() => {
    if (!workspace.id) return;
    loadDueFollowUps().catch((err) => setError(formatError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followUpSegment]);

  useEffect(() => {
    if (!workspace.id) return;
    const timer = window.setInterval(() => {
      loadSchedules().catch(() => undefined);
      loadRecentSent().catch(() => undefined);
      loadAccounts().catch(() => undefined);
    }, 12000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  useEffect(() => {
    if (!workspace.id || !autoRunSchedules) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (busy || loading || scheduleRunnerBusy || scheduleRunnerRef.current) return;
      const now = Date.now();
      const hasDueSchedule = schedules.some(
        (schedule) =>
          String(schedule.status || "") === "scheduled" &&
          new Date(schedule.scheduled_for).getTime() <= now,
      );
      if (hasDueSchedule) runDueSchedulesFromApp({ silent: true }).catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, autoRunSchedules, busy, loading, scheduleRunnerBusy, schedules]);

  function templatesForSend(kind: MessageKind = "initial") {
    const requiredType = kind === "follow_up" ? "follow_up" : "initial";
    const hasRequiredType = (template: MessageTemplate) =>
      String(template.template_type || "initial") === requiredType;
    const allowed = (items: MessageTemplate[]) =>
      items.filter((t) => t.active !== false && hasRequiredType(t));
    const scoped = allowed(categoryTemplates);
    const allAllowed = allowed(sendableTemplates);

    if (templateMode === "rotate") return scoped.length ? scoped : allAllowed;
    if (
      currentTemplate &&
      hasRequiredType(currentTemplate) &&
      currentTemplate.active !== false
    )
      return [currentTemplate];
    return scoped.length ? scoped.slice(0, 1) : allAllowed.slice(0, 1);
  }

  function accountsForSend() {
    if (senderMode === "specific")
      return connectedAccounts.filter((a) => a.id === specificSenderId);
    return connectedAccounts.filter((a) => selectedAccounts[a.id]);
  }

  function senderCap(account: GmailAccount) {
    const raw = senderRunLimits[account.id];
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      const defaultLimit = Number(
        account.default_run_limit || account.daily_limit || 0,
      );
      return Number.isFinite(defaultLimit) && defaultLimit > 0
        ? Math.floor(defaultLimit)
        : Number.POSITIVE_INFINITY;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0)
      return Number.POSITIVE_INFINITY;
    return Math.floor(parsed);
  }

  function describeSenderCaps(accountsToUse: GmailAccount[]) {
    return accountsToUse
      .map(
        (account) =>
          `${account.email}: ${Number.isFinite(senderCap(account)) ? senderCap(account).toLocaleString() : "auto"}`,
      )
      .join(" · ");
  }

  async function getContactsForSend(
    limitOverride?: number,
    contactsOverride?: Business[],
  ) {
    const selected =
      contactsOverride || readyContacts.filter((b) => selectedContacts[b.id]);
    const unique = new Map<string, Business>();
    const limit = Math.max(
      1,
      Math.min(
        MAX_MESSAGE_BATCH_SIZE,
        Number(limitOverride || sendLimit || 1000),
      ),
    );
    if (selected.length) {
      for (const business of applyLocationFilter(selected, countryFilter)) {
        const key = normalizeEmail(business.email);
        if (key && !unique.has(key)) unique.set(key, business);
      }
      return Array.from(unique.values()).slice(0, limit);
    }
    const cleanSearch = readySearch.trim().replace(/[%_]/g, "");
    const cleanCategory = businessCategoryFilter.trim().replace(/[%_]/g, "");
    const cleanCountry = countryFilter.trim().replace(/[%_]/g, "");
    const queryLimit = cleanCountry ? Math.max(1000, Math.min(10000, limit * 8)) : limit;
    let query = contactableStatusQuery(
      supabase
        .from("businesses")
        .select("*")
        .eq("workspace_id", workspace.id)
        .not("email", "is", null)
        .neq("email", "")
        .order("updated_at", { ascending: true })
        .limit(queryLimit),
    );
    if (cleanSearch)
      query = query.or(
        `name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,domain.ilike.%${cleanSearch}%,website.ilike.%${cleanSearch}%`,
      );
    if (audienceCategoryId) query = query.eq("category_id", audienceCategoryId);
    else if (cleanCategory)
      query = query.ilike("category", `%${cleanCategory}%`);
    const { data, error: loadError } = await query;
    if (loadError) throw loadError;
    for (const business of applyLocationFilter((data || []) as Business[], cleanCountry)) {
      const key = normalizeEmail(business.email);
      if (key && !unique.has(key)) unique.set(key, business);
    }
    return Array.from(unique.values()).slice(0, limit);
  }

  async function repairReadyContacts() {
    setBusy(true);
    setError("");
    try {
      const { data, error: repairError } = await supabase.rpc(
        "mark_ready_emails_and_pending_no_email",
        { target_workspace: workspace.id },
      );
      if (repairError) throw repairError;
      const row = Array.isArray(data) ? data[0] : data;
      setStatus(
        `Ready with email: ${Number(row?.ready_count || 0).toLocaleString()}. Pending without email: ${Number(row?.pending_count || 0).toLocaleString()}.`,
      );
      await loadReadyContacts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function buildContactPayload(
    business: Business,
    template: MessageTemplate,
    index: number,
  ) {
    const subjects = splitSubjects(template.subject, template.subject_variants);
    return {
      id: business.id,
      businessId: business.id,
      name: business.name || "",
      businessName: business.name || "",
      email: normalizeEmail(business.email),
      subject: renderTemplate(
        subjects[index % Math.max(1, subjects.length)] || template.subject,
        business,
      ),
      message: renderTemplate(template.message, business),
      templateId: template.id,
      templateName: template.name,
      categoryId: template.category_id || "",
      categoryName: template.category_name || "",
      website: business.website || "",
      domain: business.domain || getDomain(business),
      source: business.source || "scout_v818",
    };
  }

  async function markSenderPaused(
    account: GmailAccount,
    reason: string,
    pausedUntil?: string,
  ) {
    const until = pausedUntil || toDateTomorrow();
    await supabase
      .from("gmail_accounts")
      .update({ status: "limit_hit", paused_until: until, last_error: reason })
      .eq("workspace_id", workspace.id)
      .eq("id", account.id);
  }

  async function logOutreachEvent(payload: Record<string, unknown>) {
    await supabase
      .from("outreach_events")
      .insert({ workspace_id: workspace.id, ...payload });
  }

  async function persistSendOutcome(params: {
    business: Business;
    template: MessageTemplate;
    account: GmailAccount;
    result: SendResult;
    batchId: string;
    subject: string;
    body: string;
    dryRun: boolean;
    isFollowUp?: boolean;
  }) {
    const {
      business,
      template,
      account,
      result,
      batchId,
      subject: sentSubject,
      body,
      dryRun: isDryRun,
      isFollowUp,
    } = params;
    const statusText = String(result.status || "").toLowerCase();
    const isSent = statusText === "sent";
    const sentAt = new Date().toISOString();
    const row = {
      workspace_id: workspace.id,
      business_id: business.id,
      template_id: template.id,
      gmail_account_id: account.id,
      batch_id: batchId,
      to_email: normalizeEmail(business.email),
      from_email: normalizeEmail(account.email),
      subject: sentSubject,
      body,
      provider_message_id: result.gmailMessageId || null,
      gmail_thread_id: result.gmailThreadId || null,
      status: isSent ? "sent" : statusText || "failed",
      delivery_status: isSent ? "sent" : statusText || "failed",
      error_code: result.code || null,
      sent_at: sentAt,
      is_follow_up: !!isFollowUp,
      raw: { ...result, dry_run: isDryRun, follow_up: !!isFollowUp },
    };
    const { error: insertError } = await supabase
      .from("sent_messages")
      .insert(row);
    if (insertError) throw insertError;
    if (isSent && !isDryRun) {
      await supabase
        .from("businesses")
        .update({ status: "contacted", updated_at: sentAt })
        .eq("workspace_id", workspace.id)
        .eq("id", business.id);
      await supabase
        .from("gmail_accounts")
        .update({
          sent_today: Number(account.sent_today || 0) + 1,
          last_error: null,
        })
        .eq("workspace_id", workspace.id)
        .eq("id", account.id);
      account.sent_today = Number(account.sent_today || 0) + 1;
    }
  }

  async function startDurableSendJob(
    contactsOverride?: Business[],
    options?: {
      isFollowUp?: boolean;
      limit?: number;
      messageKind?: MessageKind;
      followupSegment?: string;
    },
  ) {
    const messageKind: MessageKind =
      options?.messageKind || (options?.isFollowUp ? "follow_up" : "initial");
    const templatePool = templatesForSend(messageKind);
    const senders = accountsForSend();
    if (!templatePool.length)
      throw new Error(
        messageKind === "follow_up"
          ? "Create/select at least one follow-up template first. Initial-message templates are no longer used for follow-ups."
          : "Create/select at least one initial-message template in Templates first.",
      );
    if (!senders.length)
      throw new Error("Select at least one connected sender first.");
    const guardBusiness =
      previewBusiness ||
      readyContacts[0] ||
      ({
        name: "there",
        email: "test@example.com",
        website: "",
        domain: "",
        category: "",
        location: "",
        source: "Scout",
      } as Business);
    const guardTemplate = templatePool[0];
    const guardSubject = renderTemplate(
      splitSubjects(guardTemplate.subject, guardTemplate.subject_variants)[0] ||
        guardTemplate.subject,
      guardBusiness,
    );
    const guardBody = renderTemplate(guardTemplate.message, guardBusiness);
    const guard = analyzeSpamRisk(guardSubject, guardBody);
    if (guard.level === "High" && !allowHighRiskSend && !dryRun)
      throw new Error(
        `Safety Check blocked this send because the template risk is HIGH (${guard.score}/100). Fix the template or tick the override checkbox.`,
      );

    const selectedBusinessIds = contactsOverride?.length
      ? contactsOverride.map((b) => b.id).filter(Boolean)
      : selectedContactIds;
    const targetCount =
      selectedBusinessIds.length ||
      Math.max(
        1,
        Math.min(
          MAX_MESSAGE_BATCH_SIZE,
          Number(options?.limit || sendLimit || 1000),
        ),
      );
    const senderLimitsById = Object.fromEntries(
      senders.map((s) => [
        s.id,
        Number.isFinite(senderCap(s)) ? senderCap(s) : "auto",
      ]),
    );
    const senderLimitsByEmail = Object.fromEntries(
      senders.map((s) => [
        s.email,
        Number.isFinite(senderCap(s)) ? senderCap(s) : "auto",
      ]),
    );

    const response = await fetch("/api/message/start-job", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: workspace.id,
        type: messageKind,
        categoryId,
        templateId:
          templateMode === "specific" ? templatePool[0]?.id || null : null,
        targetCount,
        scheduledFor: new Date().toISOString(),
        runNow: true,
        runKind: "manual_now",
        selectedBusinessIds,
        selectedSenderIds: senders.map((s) => s.id),
        selectedSenderEmails: senders.map((s) => s.email),
        templateMode,
        senderMode,
        senderRunLimits: { ...senderLimitsById, ...senderLimitsByEmail },
        businessCategoryFilter,
        countryFilter,
        locationFilter: countryFilter,
        audienceCategoryId,
        audienceCategoryName: selectedAudienceCategory?.name || "",
        readySearch,
        dryRun,
        allowHighRiskSend,
        followupSegment: options?.followupSegment || followUpSegment,
        raw: {
          source: "message_page_durable_send",
          previous_client_loop_disabled: true,
          audience_category_id: audienceCategoryId || null,
          audience_category_name: selectedAudienceCategory?.name || null,
        },
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.success === false)
      throw new Error(
        json?.error || `Start job failed with HTTP ${response.status}`,
      );
    const scheduleId = json?.schedule?.id || "";
    setProgress(0);
    setSummary({
      requested: targetCount,
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      stopped: false,
    });
    setSelectedContacts({});
    setStatus(
      `Durable ${messageKind === "follow_up" ? "follow-up" : "message"} job started for ${targetCount.toLocaleString()} contact(s). Keep Scout open and the in-app runner will continue it. Job: ${scheduleId}`,
    );
    await Promise.all([
      loadSchedules(),
      loadReadyContacts(),
      loadRecentSent(),
      loadDueFollowUps(),
      loadAccounts(),
    ]);
  }

  async function sendBatch(
    contactsOverride?: Business[],
    options?: {
      isFollowUp?: boolean;
      limit?: number;
      messageKind?: MessageKind;
      followupSegment?: string;
    },
  ) {
    setBusy(true);
    setError("");
    setProgress(0);
    setLastResults([]);
    setSummary({
      requested: 0,
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      stopped: false,
    });
    try {
      // v8.48: Send Now uses the proven immediate sender again.
      // It does not use cron. Send Now runs directly from this open page.
      const messageKind: MessageKind =
        options?.messageKind || (options?.isFollowUp ? "follow_up" : "initial");
      const templatePool = templatesForSend(messageKind);
      if (!templatePool.length)
        throw new Error(
          messageKind === "follow_up"
            ? "Create/select at least one follow-up template first. Initial-message templates are no longer used for follow-ups."
            : "Create/select at least one initial-message template in Templates first.",
        );
      let activeAccounts = accountsForSend();
      if (!activeAccounts.length)
        throw new Error(
          "Connect Gmail in Settings, then select at least one connected sender here.",
        );
      const guardBusiness =
        previewBusiness ||
        readyContacts[0] ||
        ({
          name: "there",
          email: "test@example.com",
          website: "",
          domain: "",
          category: "",
          location: "",
          source: "Scout",
        } as Business);
      const guardTemplate = templatePool[0];
      const guardSubject = renderTemplate(
        splitSubjects(
          guardTemplate.subject,
          guardTemplate.subject_variants,
        )[0] || guardTemplate.subject,
        guardBusiness,
      );
      const guardBody = renderTemplate(guardTemplate.message, guardBusiness);
      const guard = analyzeSpamRisk(guardSubject, guardBody);
      if (guard.level === "High" && !allowHighRiskSend && !dryRun) {
        throw new Error(
          `Safety Check blocked this send because the template risk is HIGH (${guard.score}/100). Fix the template or tick the override checkbox.`,
        );
      }
      const totalRequested = Math.max(
        1,
        Math.min(
          MAX_MESSAGE_BATCH_SIZE,
          Number(options?.limit || sendLimit || 1000),
        ),
      );
      const finiteCapSum = activeAccounts.reduce(
        (sum, account) =>
          sum + (Number.isFinite(senderCap(account)) ? senderCap(account) : 0),
        0,
      );
      const everySenderCapped = activeAccounts.every((account) =>
        Number.isFinite(senderCap(account)),
      );
      const effectiveLimit = everySenderCapped
        ? Math.min(totalRequested, finiteCapSum || totalRequested)
        : totalRequested;
      const contacts = await getContactsForSend(
        effectiveLimit,
        contactsOverride,
      );
      if (!contacts.length)
        throw new Error(
          messageKind === "follow_up"
            ? "No still-due follow-up contacts with email found. Scout re-checked the segment before sending."
            : "No Ready contacts with email found.",
        );

      const batchId = `scout_v830_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { error: batchError } = await supabase
        .from("outreach_batches")
        .insert({
          id: batchId,
          workspace_id: workspace.id,
          template_id: templatePool[0].id,
          requested_count: contacts.length,
          selected_sender_count: activeAccounts.length,
          status: dryRun ? "dry_run" : "running",
          raw: {
            selected_accounts: activeAccounts.map((a) => a.email),
            sender_run_limits: Object.fromEntries(
              activeAccounts.map((a) => [
                a.email,
                Number.isFinite(senderCap(a)) ? senderCap(a) : "auto",
              ]),
            ),
            dryRun,
            delayMs,
            templateMode,
            senderMode,
            categoryId,
            businessCategoryFilter,
            countryFilter,
            locationFilter: countryFilter,
            locationFilterMode: "uploaded_list_multi_field",
            messageKind,
            isFollowUp: !!options?.isFollowUp,
            followupSegment: options?.followupSegment || null,
          },
        });
      if (batchError) throw batchError;

      const rowsForDownload: Array<Record<string, unknown>> = [];
      let cursor = 0;
      const sentBySender: Record<string, number> = Object.fromEntries(
        activeAccounts.map((a) => [a.id, 0]),
      );
      let attempted = 0;
      let sent = 0;
      let failed = 0;
      let skipped = 0;
      let stopped = false;
      const requested = contacts.length;
      setStatus(
        `Sending now: 0 / ${requested.toLocaleString()} started. Keep this page open until it finishes.`,
      );
      emitLiveActivity({
        kind: "send",
        status: "started",
        title: "Send started",
        message: `Starting ${requested.toLocaleString()} email(s).`,
        countText: `0 / ${requested.toLocaleString()}`
      });

      for (let i = 0; i < contacts.length; i++) {
        if (!activeAccounts.length) {
          stopped = true;
          skipped += contacts.length - i;
          setStatus(
            "All selected Gmail senders are paused/limited. Remaining contacts stayed Ready.",
          );
          break;
        }
        const business = contacts[i];
        const eligibleAccounts = activeAccounts.filter(
          (account) => (sentBySender[account.id] || 0) < senderCap(account),
        );
        if (!eligibleAccounts.length) {
          stopped = true;
          skipped += contacts.length - i;
          setStatus(
            "All selected Gmail senders reached their run caps or were paused. Remaining contacts stayed Ready.",
          );
          break;
        }
        const account =
          senderMode === "specific"
            ? eligibleAccounts[0]
            : eligibleAccounts[cursor % eligibleAccounts.length];
        const template =
          templateMode === "specific"
            ? templatePool[0]
            : templatePool[i % templatePool.length];
        cursor += 1;
        const payload = buildContactPayload(business, template, i);
        attempted += 1;
        setStatus(
          `Sending now ${attempted.toLocaleString()} / ${requested.toLocaleString()} · ${account.email} → ${payload.email}`,
        );
        emitLiveActivity({
          kind: "send",
          status: "sending",
          title: "Sending message",
          message: `Sending message to ${payload.email}`,
          toEmail: payload.email,
          fromEmail: account.email,
          businessName: business.name || "",
          countText: `${attempted.toLocaleString()} / ${requested.toLocaleString()}`
        });

        const response = await fetch("/api/gmail/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspace.id,
            gmail_account_id: account.id,
            to: payload.email,
            subject: payload.subject,
            body: payload.message,
            dryRun,
          }),
        });
        const json = await response.json().catch(() => ({}));
        const result = ((json?.results || [])[0] || {}) as SendResult;
        const statusText = String(
          result.status || (json?.success ? "sent" : "failed"),
        ).toLowerCase();
        const limitHit = isLimitPayload(json, result);

        if (json?.access_token) {
          await supabase
            .from("gmail_accounts")
            .update({ access_token: json.access_token })
            .eq("workspace_id", workspace.id)
            .eq("id", account.id);
          account.access_token = json.access_token;
        }

        if (!response.ok && limitHit) {
          const reason =
            json?.error ||
            result.reason ||
            `Gmail limit reached for ${account.email}`;
          await markSenderPaused(
            account,
            reason,
            String(json?.senderPausedUntil || result.pausedUntil || ""),
          );
          await logOutreachEvent({
            batch_id: batchId,
            business_id: business.id,
            gmail_account_id: account.id,
            template_id: template.id,
            type: "sender_limit",
            message: reason,
            raw: json,
          });
          rowsForDownload.push({
            business: business.name,
            email: business.email,
            sender: account.email,
            template: template.name,
            status: "not_sent_sender_limit",
            reason,
          });
          emitLiveActivity({
            kind: "send",
            status: "paused",
            title: "Sender limit reached",
            message: `${account.email} was paused before sending to ${payload.email}.`,
            toEmail: payload.email,
            fromEmail: account.email,
            businessName: business.name || "",
            countText: `${attempted.toLocaleString()} / ${requested.toLocaleString()}`
          });
          activeAccounts = activeAccounts.filter((a) => a.id !== account.id);
          failed += 1;
          i -= 1;
          if (!activeAccounts.length) {
            stopped = true;
            skipped += contacts.length - i - 1;
            break;
          }
          continue;
        }

        if (!response.ok || json?.success === false) {
          const blocked = isBlockedPayload(json, result);
          const failedStatus = blocked ? "message_blocked" : "failed";
          const reason =
            json?.error ||
            result.reason ||
            `Send failed with HTTP ${response.status}`;
          failed += 1;
          rowsForDownload.push({
            business: business.name,
            email: business.email,
            sender: account.email,
            template: template.name,
            status: failedStatus,
            reason,
          });
          await persistSendOutcome({
            business,
            template,
            account,
            result: {
              ...result,
              status: failedStatus,
              reason,
              code: result.code || (blocked ? "message_blocked" : undefined),
            },
            batchId,
            subject: payload.subject,
            body: payload.message,
            dryRun,
            isFollowUp: options?.isFollowUp,
          });
          await logOutreachEvent({
            batch_id: batchId,
            business_id: business.id,
            gmail_account_id: account.id,
            template_id: template.id,
            type: failedStatus,
            message: reason,
            raw: json,
          });
          emitLiveActivity({
            kind: "send",
            status: failedStatus,
            title: blocked ? "Message blocked" : "Send failed",
            message: `${payload.email}: ${reason}`,
            toEmail: payload.email,
            fromEmail: account.email,
            businessName: business.name || "",
            countText: `${attempted.toLocaleString()} / ${requested.toLocaleString()}`
          });
        } else if (statusText === "sent" || statusText === "dry_run") {
          if (statusText === "sent") sent += 1;
          else skipped += 1;
          rowsForDownload.push({
            business: business.name,
            email: business.email,
            sender: account.email,
            template: template.name,
            status: statusText,
            subject: payload.subject,
            gmailMessageId: result.gmailMessageId || "",
          });
          await persistSendOutcome({
            business,
            template,
            account,
            result: { ...result, status: statusText },
            batchId,
            subject: payload.subject,
            body: payload.message,
            dryRun,
            isFollowUp: options?.isFollowUp,
          });
          if (statusText === "sent") {
            sentBySender[account.id] = (sentBySender[account.id] || 0) + 1;
            setStatus(
              `Message sent ${sent.toLocaleString()} / ${requested.toLocaleString()} · ${account.email} → ${payload.email}`,
            );
            emitLiveActivity({
              kind: "send",
              status: "sent",
              title: "Message sent",
              message: `Message sent to ${payload.email}`,
              toEmail: payload.email,
              fromEmail: account.email,
              businessName: business.name || "",
              countText: `${sent.toLocaleString()} sent · ${attempted.toLocaleString()} / ${requested.toLocaleString()}`
            });
          }
          await logOutreachEvent({
            batch_id: batchId,
            business_id: business.id,
            gmail_account_id: account.id,
            template_id: template.id,
            type: statusText,
            message: `${statusText}: ${payload.email}`,
            raw: result,
          });
        } else {
          skipped += 1;
          const reason = result.reason || statusText || "not_sent";
          rowsForDownload.push({
            business: business.name,
            email: business.email,
            sender: account.email,
            template: template.name,
            status: statusText,
            reason,
          });
          await persistSendOutcome({
            business,
            template,
            account,
            result: { ...result, status: statusText },
            batchId,
            subject: payload.subject,
            body: payload.message,
            dryRun,
            isFollowUp: options?.isFollowUp,
          });
          emitLiveActivity({
            kind: "send",
            status: statusText || "skipped",
            title: "Message not sent",
            message: `${payload.email}: ${reason}`,
            toEmail: payload.email,
            fromEmail: account.email,
            businessName: business.name || "",
            countText: `${attempted.toLocaleString()} / ${requested.toLocaleString()}`
          });
        }

        setProgress(Math.round(((i + 1) / contacts.length) * 100));
        setSummary({ requested, attempted, sent, failed, skipped, stopped });
      }

      const finalStatus = stopped
        ? "stopped"
        : dryRun
          ? "dry_run_complete"
          : "complete";
      await supabase
        .from("outreach_batches")
        .update({
          status: finalStatus,
          attempted_count: attempted,
          sent_count: sent,
          failed_count: failed,
          skipped_count: skipped,
          finished_at: new Date().toISOString(),
        })
        .eq("workspace_id", workspace.id)
        .eq("id", batchId);
      setLastResults(rowsForDownload);
      setProgress(100);
      setSummary({ requested, attempted, sent, failed, skipped, stopped });
      setSelectedContacts({});
      setStatus(
        `Batch ${finalStatus}. Requested ${requested}, sent ${sent}, failed ${failed}, skipped/not sent ${skipped}.`,
      );
      emitLiveActivity({
        kind: "send",
        status: finalStatus,
        title: "Send finished",
        message: `Requested ${requested.toLocaleString()}, sent ${sent.toLocaleString()}, failed ${failed.toLocaleString()}, skipped ${skipped.toLocaleString()}.`,
        countText: `${sent.toLocaleString()} sent`
      });
      await Promise.all([
        loadReadyContacts(),
        loadAccounts(),
        loadRecentSent(),
        loadDueFollowUps(),
      ]);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule() {
    setBusy(true);
    setError("");
    try {
      const templatePool = templatesForSend(scheduleType);
      const senders = accountsForSend();
      if (!templatePool.length)
        throw new Error("Create/select at least one template first.");
      if (!senders.length)
        throw new Error("Select at least one connected sender first.");
      const { error: insertError } = await supabase
        .from("message_schedules")
        .insert({
          workspace_id: workspace.id,
          type: scheduleType,
          category_id: categoryId || null,
          audience_category_id: audienceCategoryId || null,
          audience_category_name: selectedAudienceCategory?.name || null,
          template_id:
            templateMode === "specific" ? templatePool[0]?.id || null : null,
          target_count: Math.max(
            1,
            Math.min(
              MAX_MESSAGE_BATCH_SIZE,
              Number(scheduleCount || sendLimit || 1000),
            ),
          ),
          scheduled_for: new Date(scheduleFor).toISOString(),
          status: "scheduled",
          run_kind: "scheduled",
          followup_segment:
            scheduleType === "follow_up" ? followUpSegment : null,
          raw: {
            audience_category_id: audienceCategoryId || null,
            audience_category_name: selectedAudienceCategory?.name || null,
            business_category_filter: businessCategoryFilter,
            country_filter: countryFilter,
            location_filter: countryFilter,
            location_filter_mode: "uploaded_list_multi_field",
            followup_segment:
              scheduleType === "follow_up" ? followUpSegment : null,
            template_mode: templateMode,
            sender_mode: senderMode,
            selected_sender_ids: senders.map((s) => s.id),
            selected_sender_emails: senders.map((s) => s.email),
            sender_run_limits: Object.fromEntries(
              senders.map((s) => [
                s.email,
                Number.isFinite(senderCap(s)) ? senderCap(s) : "auto",
              ]),
            ),
            delay_ms: delayMs,
            dry_run: dryRun,
            allow_high_risk_send: allowHighRiskSend,
          },
        });
      if (insertError) throw insertError;
      setStatus("Schedule saved. Keep Scout open on this page; the in-app schedule runner will start it when the time arrives.");
      await loadSchedules();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function scheduleFollowUpsForDue() {
    setBusy(true);
    setError("");
    try {
      if (!dueFollowUps.length) throw new Error("No due follow-ups found.");
      const templatePool = templatesForSend("follow_up");
      const senders = accountsForSend();
      if (!templatePool.length)
        throw new Error("Create/select at least one follow-up template first.");
      if (!senders.length)
        throw new Error("Select at least one connected sender first.");
      const { error: insertError } = await supabase
        .from("message_schedules")
        .insert({
          workspace_id: workspace.id,
          type: "follow_up",
          category_id: categoryId || null,
          audience_category_id: audienceCategoryId || null,
          audience_category_name: selectedAudienceCategory?.name || null,
          template_id:
            templateMode === "specific" ? templatePool[0]?.id || null : null,
          target_count: dueFollowUps.length,
          scheduled_for: new Date(followUpFor).toISOString(),
          status: "scheduled",
          run_kind: "scheduled_follow_up",
          followup_segment: followUpSegment,
          raw: {
            due_mode: true,
            audience_category_id: audienceCategoryId || null,
            audience_category_name: selectedAudienceCategory?.name || null,
            followup_segment: followUpSegment,
            followup_after_hours: 72,
            due_business_ids: dueFollowUps.map((d) => d.business_id),
            template_mode: templateMode,
            sender_mode: senderMode,
            selected_sender_ids: senders.map((s) => s.id),
            selected_sender_emails: senders.map((s) => s.email),
            sender_run_limits: Object.fromEntries(
              senders.map((s) => [
                s.email,
                Number.isFinite(senderCap(s)) ? senderCap(s) : "auto",
              ]),
            ),
            dry_run: dryRun,
            allow_high_risk_send: allowHighRiskSend,
          },
        });
      if (insertError) throw insertError;
      setStatus(
        `Scheduled ${dueFollowUps.length.toLocaleString()} due follow-up(s).`,
      );
      await loadSchedules();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function getDueFollowUpBusinesses(
    limit = 1000,
    rowsOverride?: DueFollowUp[],
  ) {
    const rows = (rowsOverride || dueFollowUps).slice(0, limit);
    if (!rows.length) return [] as Business[];
    const ids = rows.map((r) => r.business_id);
    const { data, error: loadError } = await supabase
      .from("businesses")
      .select("*")
      .eq("workspace_id", workspace.id)
      .in("id", ids);
    if (loadError) throw loadError;
    const byId = new Map(
      ((data || []) as Business[]).map((business) => [business.id, business]),
    );
    return ids.map((id) => byId.get(id)).filter(Boolean) as Business[];
  }

  async function sendDueFollowUpsNow() {
    const freshDue = await fetchDueFollowUps(
      Math.min(Number(sendLimit || 1000), 1000),
    );
    setDueFollowUps(freshDue);
    const contacts = await getDueFollowUpBusinesses(
      Math.min(Number(sendLimit || 1000), freshDue.length || 1000),
      freshDue,
    );
    await sendBatch(contacts, {
      isFollowUp: true,
      limit: contacts.length,
      messageKind: "follow_up",
      followupSegment: followUpSegment,
    });
  }

  async function runDueSchedulesFromApp(options?: { silent?: boolean }) {
    if (scheduleRunnerRef.current) return { ran: 0, skipped: true };
    scheduleRunnerRef.current = true;
    setScheduleRunnerBusy(true);
    if (!options?.silent) {
      setBusy(true);
      setError("");
      setStatus("Running due schedules from this open app...");
    }
    try {
      const response = await fetch("/api/message/run-schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          limit: 1,
          workspaceId: workspace.id,
          targetLimit: 25,
          senderRunLimit: 25,
          source: "open_app_schedule_runner",
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false)
        throw new Error(
          json?.error || `Due schedule run failed with HTTP ${response.status}`,
        );
      const results = Array.isArray(json.results) ? json.results : [];
      const sent = results.reduce(
        (sum: number, row: any) => sum + Number(row.sent || 0),
        0,
      );
      const failed = results.reduce(
        (sum: number, row: any) => sum + Number(row.failed || 0),
        0,
      );
      const skipped = results.reduce(
        (sum: number, row: any) => sum + Number(row.skipped || 0),
        0,
      );
      if (Number(json.ran || 0) > 0 || !options?.silent) {
        setStatus(
          Number(json.ran || 0) > 0
            ? `Open-app schedule runner processed ${Number(json.ran || 0)} schedule(s). Sent ${sent}, failed ${failed}, skipped ${skipped}. It will continue while this page stays open.`
            : "No due schedules right now.",
        );
      }
      await Promise.all([
        loadSchedules(),
        loadReadyContacts(),
        loadRecentSent(),
        loadDueFollowUps(),
        loadAccounts(),
      ]);
      return json;
    } catch (err) {
      if (!options?.silent) setError(formatError(err));
      else setStatus(`Auto-run schedule check failed: ${formatError(err)}`);
      return { ran: 0, error: formatError(err) };
    } finally {
      scheduleRunnerRef.current = false;
      setScheduleRunnerBusy(false);
      if (!options?.silent) setBusy(false);
    }
  }

  async function sendDueSchedulesNow() {
    await runDueSchedulesFromApp({ silent: false });
  }

  async function syncBlockedAndBounced() {
    const selected = accountsForSend();
    if (!selected.length)
      return setError("Select at least one connected sender first.");
    setBusy(true);
    setError("");
    try {
      let scanned = 0;
      let noInbox = 0;
      let blocked = 0;
      for (const account of selected) {
        setStatus(
          `Checking ${account.email} for bounces, no-inbox, and blocked-message notices...`,
        );
        const response = await fetch("/api/gmail/sync-bounces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspace.id,
            gmail_account_id: account.id,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json?.success === false)
          throw new Error(
            json?.error || `Bounce sync failed for ${account.email}`,
          );
        scanned += Number(json.scanned || 0);
        noInbox += Number(json.noInbox || 0);
        blocked += Number(json.blocked || 0);
      }
      setStatus(
        `Bounce/block sync finished. Scanned ${scanned}, no-inbox/bounce ${noInbox}, message-blocked ${blocked}.`,
      );
      await Promise.all([loadRecentSent(), loadDueFollowUps()]);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleAllContacts(value: boolean) {
    if (!value) return setSelectedContacts({});
    setSelectedContacts(
      Object.fromEntries(readyContacts.map((b) => [b.id, true])),
    );
  }

  function onCategoryChange(value: string) {
    setCategoryId(value);
    const first = templates.find((t) => t.category_id === value);
    if (first) setTemplateId(first.id);
  }

  function senderCountLine(account: GmailAccount) {
    const sent = Number(senderLast24h[account.id] || 0);
    const limit = Number(account.daily_limit || 0);
    return limit > 0
      ? `${sent.toLocaleString()} sent in last 24h / ${limit.toLocaleString()} daily limit`
      : `${sent.toLocaleString()} sent in last 24h`;
  }

  const activeSchedules = schedules.filter((s) => ["scheduled", "due", "running"].includes(String(s.status || "")));

  function scheduleProgressText(schedule: MessageSchedule) {
    const target = Number(schedule.target_count || 0);
    const processed = Number(schedule.processed_count || 0);
    const sent = Number(schedule.sent_count || 0);
    const failed = Number(schedule.failed_count || 0);
    const skipped = Number(schedule.skipped_count || 0);
    const parts = [`${processed.toLocaleString()} / ${target.toLocaleString()} processed`, `${sent.toLocaleString()} sent`];
    if (failed) parts.push(`${failed.toLocaleString()} failed`);
    if (skipped) parts.push(`${skipped.toLocaleString()} skipped`);
    return parts.join(" · ");
  }

  async function stopSchedule(schedule: MessageSchedule) {
    setStopBusyId(schedule.id);
    setError("");
    try {
      const response = await fetch("/api/message/stop-schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id, scheduleId: schedule.id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Stop failed with HTTP ${response.status}`);
      setStatus("Stop requested. If a message is already in-flight, Scout will stop after the current recipient finishes.");
      await loadSchedules();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setStopBusyId("");
    }
  }

  return (
    <div className="stack">
      {error ? <div className="error">{error}</div> : null}
      <div className="success">{status}</div>
      {busy || loading ? (
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${progress || (loading ? 30 : 0)}%` }}
          />
        </div>
      ) : null}

      <div className="grid grid-4">
        <div className="card kpi">
          <div className="title">Ready</div>
          <div className="num">{readyTotal.toLocaleString()}</div>
        </div>
        <div className="card kpi">
          <div className="title">Senders</div>
          <div className="num">{connectedAccounts.length}</div>
        </div>
        <div className="card kpi">
          <div className="title">Templates</div>
          <div className="num">{categoryTemplates.length}</div>
        </div>
        <div className="card kpi">
          <div className="title">Due Follow Up</div>
          <div className="num">{dueFollowUps.length}</div>
        </div>
      </div>

      {activeSchedules.length ? (
        <div className="card" style={{ padding: 18 }}>
          <h3>Active Sending Jobs</h3>
          <p className="muted">These jobs are controlled from this app. No cron is required.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Status</th><th>Progress</th><th>Scheduled</th><th>Action</th></tr></thead>
              <tbody>
                {activeSchedules.slice(0, 6).map((job) => (
                  <tr key={`active-${job.id}`}>
                    <td>{job.type === "follow_up" ? "Follow-up" : "Initial"}</td>
                    <td>{job.status}</td>
                    <td>{scheduleProgressText(job)}{job.last_error ? <><br /><span className="error">{job.last_error}</span></> : null}</td>
                    <td>{new Date(job.scheduled_for).toLocaleString()}</td>
                    <td><button className="btn secondary" type="button" disabled={Boolean(stopBusyId)} onClick={() => stopSchedule(job)}>{stopBusyId === job.id ? "Stopping…" : "Stop"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: 18 }}>
        <h3>Choose who gets the email</h3>
        <p className="muted" style={{ marginTop: -4 }}>
          Choose the audience and matching template category.
        </p>
        <div className="grid grid-4">
          <div>
            <label className="label">Audience</label>
            <select
              className="select"
              value={audienceCategoryId}
              onChange={(e) => setAudienceCategoryId(e.target.value)}
            >
              <option value="">All audiences</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Location from uploaded list</label>
            <select
              className="select"
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
            >
              <option value="">All available locations</option>
              {locationOptions.map((location) => (
                <option key={location.value} value={location.value}>
                  {location.label}
                </option>
              ))}
            </select>
            <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              Only locations found in your uploaded contactable leads are shown. Scout scans location, country, city, region, market, address, and raw uploaded fields.
            </p>
          </div>
          <div>
            <label className="label">Template category</label>
            <select
              className="select"
              value={categoryId}
              onChange={(e) => onCategoryChange(e.target.value)}
            >
              <option value="">All template categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">How many</label>
            <input
              className="input"
              type="number"
              min={1}
              max={MAX_MESSAGE_BATCH_SIZE}
              value={sendLimit}
              onChange={(e) => setSendLimit(Number(e.target.value || 1000))}
            />
          </div>
          <div>
            <label className="label">Delay between emails (ms)</label>
            <input
              className="input"
              type="number"
              min={0}
              max={60000}
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value || 0))}
            />
          </div>
        </div>

        <div className="grid grid-2" style={{ marginTop: 14 }}>
          <div className="card" style={{ padding: 14 }}>
            <h3>Template</h3>
            <label className="checkbox-row">
              <input
                type="radio"
                checked={templateMode === "specific"}
                onChange={() => setTemplateMode("specific")}
              />{" "}
              Use one template
            </label>
            <label className="checkbox-row">
              <input
                type="radio"
                checked={templateMode === "rotate"}
                onChange={() => setTemplateMode("rotate")}
              />{" "}
              Rotate templates in this category
            </label>
            <select
              className="select"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={templateMode === "rotate"}
            >
              <option value="">Select template</option>
              {(categoryId ? categoryTemplates : templates).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="btn secondary" href="/templates">
                Manage Templates
              </Link>
            </div>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <h3>Sender</h3>
            <label className="checkbox-row">
              <input
                type="radio"
                checked={senderMode === "specific"}
                onChange={() => setSenderMode("specific")}
              />{" "}
              Use one Gmail
            </label>
            <label className="checkbox-row">
              <input
                type="radio"
                checked={senderMode === "rotate"}
                onChange={() => setSenderMode("rotate")}
              />{" "}
              Rotate Gmail senders
            </label>
            {senderMode === "specific" ? (
              <select
                className="select"
                value={specificSenderId}
                onChange={(e) => setSpecificSenderId(e.target.value)}
              >
                <option value="">Select sender</option>
                {connectedAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email} ·{" "}
                    {Number(senderLast24h[a.id] || 0).toLocaleString()} sent
                    last 24h
                  </option>
                ))}
              </select>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {connectedAccounts.map((a) => (
                  <div key={a.id} className="card" style={{ padding: 10 }}>
                    <label className="checkbox-row" style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={!!selectedAccounts[a.id]}
                        onChange={(e) =>
                          setSelectedAccounts((cur) => ({
                            ...cur,
                            [a.id]: e.target.checked,
                          }))
                        }
                      />{" "}
                      {a.email}
                    </label>
                    <div className="grid grid-2" style={{ marginTop: 8 }}>
                      <div>
                        <label className="label">Max from this sender</label>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          placeholder={`Settings default: ${Number(a.default_run_limit || a.daily_limit || 0).toLocaleString()}`}
                          value={senderRunLimits[a.id] || ""}
                          onChange={(e) =>
                            setSenderRunLimits((cur) => ({
                              ...cur,
                              [a.id]: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="label">Used today</label>
                        <div className="notice" style={{ color: "#86efac" }}>
                          {senderCountLine(a)} · run default{" "}
                          {Number(a.default_run_limit || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {senderMode === "specific" && specificSenderId ? (
              <div style={{ marginTop: 10 }}>
                <label className="label">
                  Max from this sender
                </label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  placeholder={`Settings default: ${Number(connectedAccounts.find((a) => a.id === specificSenderId)?.default_run_limit || connectedAccounts.find((a) => a.id === specificSenderId)?.daily_limit || 0).toLocaleString()}`}
                  value={senderRunLimits[specificSenderId] || ""}
                  onChange={(e) =>
                    setSenderRunLimits((cur) => ({
                      ...cur,
                      [specificSenderId]: e.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
            {!connectedAccounts.length ? (
              <div className="notice" style={{ marginTop: 10 }}>
                No connected senders.{" "}
                <Link href="/settings">Connect Gmail in Settings</Link>.
              </div>
            ) : null}
            <p className="muted" style={{ marginTop: 10 }}>
              Blank sender max uses the default limit in Settings.
            </p>
          </div>
        </div>

        <div className="actions" style={{ marginTop: 14 }}>
          <label className="checkbox-row" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />{" "}
            Dry run
          </label>
          <label className="checkbox-row" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={allowHighRiskSend}
              onChange={(e) => setAllowHighRiskSend(e.target.checked)}
            />{" "}
            Override high spam-risk block
          </label>
          <button
            className="btn"
            type="button"
            disabled={busy || loading}
            onClick={() => sendBatch(undefined, { messageKind: "initial" })}
          >
            Send Now
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={busy || loading}
            onClick={refreshAll}
          >
            Refresh
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={busy || loading}
            onClick={repairReadyContacts}
          >
            Fix Lead Status
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={busy || loading}
            onClick={syncBlockedAndBounced}
          >
            Check Bad Inboxes
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={!lastResults.length}
            onClick={() =>
              downloadCsv("scout-message-last-results.csv", lastResults)
            }
          >
            Download Result
          </button>
        </div>
      </div>

      <div className="grid grid-4">
        <div className="card kpi">
          <div className="title">Requested</div>
          <div className="num">{summary.requested}</div>
        </div>
        <div className="card kpi">
          <div className="title">Attempted</div>
          <div className="num">{summary.attempted}</div>
        </div>
        <div className="card kpi">
          <div className="title">Sent</div>
          <div className="num">{summary.sent}</div>
        </div>
        <div className="card kpi">
          <div className="title">Failed</div>
          <div className="num">{summary.failed + summary.skipped}</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <div
            className="actions"
            style={{ justifyContent: "space-between", marginBottom: 12 }}
          >
            <h3 style={{ margin: 0 }}>Ready Leads</h3>
            <div className="actions">
              <input
                className="input"
                style={{ width: 260 }}
                value={readySearch}
                onChange={(e) => setReadySearch(e.target.value)}
                placeholder="Search leads"
                onKeyDown={(e) => {
                  if (e.key === "Enter") loadReadyContacts();
                }}
              />
              <button
                className="btn secondary"
                type="button"
                onClick={loadReadyContacts}
              >
                Search
              </button>
            </div>
          </div>
          <div className="actions" style={{ marginBottom: 12 }}>
            <label className="checkbox-row" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={
                  readyContacts.length > 0 &&
                  selectedContactIds.length === readyContacts.length
                }
                onChange={(e) => toggleAllContacts(e.target.checked)}
              />{" "}
              Select shown leads
            </label>
            <span className="badge">
              Showing {readyContacts.length.toLocaleString()} of{" "}
              {readyTotal.toLocaleString()}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Use</th>
                  <th>Business</th>
                  <th>Email</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {readyContacts.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!selectedContacts[b.id]}
                        onChange={(e) =>
                          setSelectedContacts((cur) => ({
                            ...cur,
                            [b.id]: e.target.checked,
                          }))
                        }
                      />
                    </td>
                    <td>
                      <strong>{b.name || "-"}</strong>
                      <br />
                      <span className="muted">
                        {b.website || b.domain || ""}
                      </span>
                    </td>
                    <td>{b.email}</td>
                    <td>{b.category_name || b.category || "-"}</td>
                  </tr>
                ))}
                {!readyContacts.length ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No Ready contacts found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3>Preview</h3>
          <div className="notice">
            Available fields:{" "}
            {SHORTCODES.map((s) => (
              <code key={s}>{s}</code>
            ))}
          </div>
          {previewBusiness && currentTemplate ? (
            <>
              <p className="muted">
                {previewBusiness.name || previewBusiness.email}
              </p>
              <label className="label">Subject</label>
              <div className="notice">{previewSubject}</div>
              <label className="label" style={{ marginTop: 12 }}>
                Body
              </label>
              <div
                className="card"
                style={{ padding: 14, whiteSpace: "pre-wrap" }}
              >
                {previewBody}
              </div>
              <div className="notice" style={{ marginTop: 12 }}>
                <strong>Safety Check:</strong> {spamReport.level} risk · score{" "}
                {spamReport.score}/100.{" "}
                {spamReport.level === "High"
                  ? "Scout will block this send unless you override."
                  : "You can send, but review findings before a large run."}
              </div>
              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                {spamReport.findings.slice(0, 6).map((f, idx) => (
                  <div className="badge" key={`${f.label}-${idx}`}>
                    {f.severity}: {f.label}
                  </div>
                ))}
                {!spamReport.findings.length ? (
                  <span className="badge">
                    No obvious spam-word issue found.
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <p className="muted">Select a template and load contacts.</p>
          )}
          <h3 style={{ marginTop: 18 }}>Recent Sent</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>To</th>
                  <th>From</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {recentSent.slice(0, 8).map((row) => (
                  <tr key={row.id}>
                    <td>{row.to_email}</td>
                    <td>{row.from_email}</td>
                    <td>{row.status}</td>
                    <td>
                      {row.sent_at
                        ? new Date(row.sent_at).toLocaleString()
                        : "-"}
                    </td>
                  </tr>
                ))}
                {!recentSent.length ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No sent logs yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <h3>Due Follow-ups — 72h no real response</h3>
          <p className="muted">
            These are contacts Scout found from sent emails older than 72 hours with no real human reply. Auto-replies are kept separate.
          </p>
          <div className="notice" style={{ marginBottom: 12 }}>
            Due now: <strong>{dueFollowUps.length.toLocaleString()}</strong> contact(s).
          </div>
          <div className="grid grid-3">
            <div>
              <label className="label">Segment</label>
              <select
                className="select"
                value={followUpSegment}
                onChange={(e) =>
                  setFollowUpSegment(
                    e.target.value as
                      | "all_unanswered"
                      | "no_reply"
                      | "auto_reply",
                  )
                }
              >
                <option value="all_unanswered">
                  All unanswered with inbox
                </option>
                <option value="no_reply">No reply at all</option>
                <option value="auto_reply">Auto-responder only</option>
              </select>
            </div>
            <div>
              <label className="label">Follow-up time</label>
              <input
                className="input"
                type="datetime-local"
                value={followUpFor}
                onChange={(e) => setFollowUpFor(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", alignItems: "end" }}>
              <button
                className="btn secondary"
                type="button"
                disabled={busy || !dueFollowUps.length}
                onClick={scheduleFollowUpsForDue}
              >
                Schedule Due Follow-ups
              </button>
            </div>
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button
              className="btn"
              type="button"
              disabled={busy || !dueFollowUps.length}
              onClick={sendDueFollowUpsNow}
            >
              Send Due Follow-ups Now
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={loadDueFollowUps}
            >
              Refresh
            </button>
          </div>
          <div className="notice" style={{ marginTop: 12 }}>
            Showing:{" "}
            <strong>{followUpSegment.replace(/_/g, " ")}</strong>. Auto replies are kept separate from human replies.
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Email</th>
                  <th>Segment</th>
                  <th>Last Sent</th>
                  <th>Subject</th>
                </tr>
              </thead>
              <tbody>
                {dueFollowUps.map((row) => (
                  <tr key={`${row.business_id}-${row.last_sent_at}`}>
                    <td>{row.business_name || "-"}</td>
                    <td>{row.to_email}</td>
                    <td>
                      {row.followup_segment ||
                        row.segment ||
                        row.reply_state ||
                        followUpSegment}
                    </td>
                    <td>{new Date(row.last_sent_at).toLocaleString()}</td>
                    <td>{row.last_subject || "-"}</td>
                  </tr>
                ))}
                {!dueFollowUps.length ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No due follow-ups yet. Scout checks sent emails older than 72 hours, excludes real replies, bounces, blocks, and no-inbox records.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3>Schedule Email</h3>
          <p className="muted">Pick a time and count. Schedules now run from the open app, not cron. Keep Scout open when you want scheduled work to start.</p>
          <div className="grid grid-3">
            <div>
              <label className="label">Type</label>
              <select
                className="select"
                value={scheduleType}
                onChange={(e) =>
                  setScheduleType(e.target.value as "initial" | "follow_up")
                }
              >
                <option value="initial">First email</option>
                <option value="follow_up">Follow-up</option>
              </select>
            </div>
            <div>
              <label className="label">Date & time</label>
              <input
                className="input"
                type="datetime-local"
                value={scheduleFor}
                onChange={(e) => setScheduleFor(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Count</label>
              <input
                className="input"
                type="number"
                value={scheduleCount}
                onChange={(e) =>
                  setScheduleCount(Number(e.target.value || 1000))
                }
              />
            </div>
          </div>
          <label className="checkbox-row" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={autoRunSchedules}
              onChange={(e) => setAutoRunSchedules(e.target.checked)}
            />{" "}
            Auto-run due schedules while this page is open
          </label>
          <div className="actions" style={{ marginTop: 12 }}>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={saveSchedule}
            >
              Save Schedule
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy || scheduleRunnerBusy}
              onClick={sendDueSchedulesNow}
            >
              {scheduleRunnerBusy ? "Running Due Sends…" : "Run Due Sends Now"}
            </button>
          </div>
          <div className="notice" style={{ marginTop: 10 }}>
            No cron is needed. A saved schedule starts automatically only while Scout is open, or when you click Run Due Sends Now.
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>For</th>
                  <th>Count</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id}>
                    <td>{s.type}</td>
                    <td>{new Date(s.scheduled_for).toLocaleString()}</td>
                    <td>{Number(s.target_count || 0).toLocaleString()}</td>
                    <td>{scheduleProgressText(s)}</td>
                    <td>{s.status}{s.last_error ? <><br /><span className="error">{s.last_error}</span></> : null}</td>
                    <td>{["scheduled", "due", "running"].includes(String(s.status || "")) ? <button className="btn secondary" type="button" disabled={Boolean(stopBusyId)} onClick={() => stopSchedule(s)}>{stopBusyId === s.id ? "Stopping…" : "Stop"}</button> : null}</td>
                  </tr>
                ))}
                {!schedules.length ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No saved schedules yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
