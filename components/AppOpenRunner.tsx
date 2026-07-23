"use client";

import { useEffect, useRef, useState } from "react";
import { emitLiveActivity } from "@/lib/live-activity-client";

const LOCK_KEY = "scout_v10_open_app_runner_lock";
const LAST_RUN_KEY = "scout_v10_open_app_runner_last_run";
const RUN_INTERVAL_MS = 5_000;
const LOCK_TTL_MS = 60_000;

const INBOUND_LOCK_KEY = "scout_v10_25_inbound_sync_lock";
const INBOUND_LAST_RUN_KEY = "scout_v10_25_inbound_sync_last_run";
const INBOUND_INTERVAL_MS = 150_000;
const INBOUND_LOCK_TTL_MS = 35_000;

const STALE_CHECK_INTERVAL_MS = 5 * 60_000;

type RunnerResponse = {
  success?: boolean;
  ran?: number;
  results?: Array<{ sent?: number; failed?: number; skipped?: number }>;
  error?: string;
};

type InboundSyncResponse = {
  success?: boolean;
  accountsChecked?: number;
  totals?: {
    scanned?: number;
    saved?: number;
    realReplies?: number;
    autoReplies?: number;
    noInbox?: number;
    blocked?: number;
    bounced?: number;
    limitNotices?: number;
    errors?: number;
  };
  error?: string;
};

type StaleSendingJob = {
  id: string;
  type?: string | null;
  status?: string | null;
  target_count?: number | null;
  processed_count?: number | null;
  sent_count?: number | null;
  failed_count?: number | null;
  skipped_count?: number | null;
  last_heartbeat_at?: string | null;
  updated_at?: string | null;
  last_error?: string | null;
  staleForMinutes?: number;
};

function now() {
  return Date.now();
}

function readNumber(key: string) {
  if (typeof window === "undefined") return 0;
  const value = Number(window.localStorage.getItem(key) || "0");
  return Number.isFinite(value) ? value : 0;
}

function acquireNamedLock(keyPrefix: string, workspaceId: string, ttlMs: number) {
  if (typeof window === "undefined") return false;
  const key = `${keyPrefix}_${workspaceId}`;
  const current = readNumber(key);
  if (current && current > now() - ttlMs) return false;
  window.localStorage.setItem(key, String(now()));
  return true;
}

function releaseNamedLock(keyPrefix: string, workspaceId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`${keyPrefix}_${workspaceId}`);
}

function acquireLock(workspaceId: string) {
  return acquireNamedLock(LOCK_KEY, workspaceId, LOCK_TTL_MS);
}

function releaseLock(workspaceId: string) {
  releaseNamedLock(LOCK_KEY, workspaceId);
}

function hoursAndMinutes(totalMinutes = 120) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!minutes) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours}h ${minutes}m`;
}

export function AppOpenRunner({ workspaceId }: { workspaceId?: string | null }) {
  const [active, setActive] = useState(false);
  const [staleJobs, setStaleJobs] = useState<StaleSendingJob[]>([]);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const busyRef = useRef(false);
  const inboundBusyRef = useRef(false);
  const staleCheckBusyRef = useRef(false);
  const staleJobsRef = useRef<StaleSendingJob[]>([]);
  const staleCheckCompleteRef = useRef(false);

  function updateStaleJobs(jobs: StaleSendingJob[]) {
    staleJobsRef.current = jobs;
    setStaleJobs(jobs);
  }

  async function checkForStaleJobs() {
    if (!workspaceId || staleCheckBusyRef.current) return staleJobsRef.current;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return staleJobsRef.current;
    staleCheckBusyRef.current = true;
    try {
      const response = await fetch("/api/message/stale-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
        cache: "no-store",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) return staleJobsRef.current;
      const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
      updateStaleJobs(jobs);
      staleCheckCompleteRef.current = true;
      return jobs;
    } finally {
      staleCheckBusyRef.current = false;
    }
  }

  async function runDueSchedulesSilently() {
    if (!workspaceId || busyRef.current) return;
    if (!staleCheckCompleteRef.current || staleCheckBusyRef.current || staleJobsRef.current.length > 0) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const lastRunKey = `${LAST_RUN_KEY}_${workspaceId}`;
    const lastRun = readNumber(lastRunKey);
    if (lastRun && lastRun > now() - RUN_INTERVAL_MS) return;
    if (!acquireLock(workspaceId)) return;

    busyRef.current = true;
    setActive(true);
    window.localStorage.setItem(lastRunKey, String(now()));
    try {
      const response = await fetch("/api/message/run-schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          limit: 1,
          source: "v10_40_stale_confirmation_app_runner",
        }),
      });
      const json = (await response.json().catch(() => ({}))) as RunnerResponse;
      if (!response.ok || json?.success === false) {
        const message = json?.error || `Open app runner failed with HTTP ${response.status}`;
        emitLiveActivity({
          kind: "schedule",
          status: "runner_note",
          title: "Schedule check",
          message,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      const ran = Number(json.ran || 0);
      if (ran > 0) {
        const results = Array.isArray(json.results) ? json.results : [];
        const sent = results.reduce((sum, row) => sum + Number(row.sent || 0), 0);
        const failed = results.reduce((sum, row) => sum + Number(row.failed || 0), 0);
        const skipped = results.reduce((sum, row) => sum + Number(row.skipped || 0), 0);
        if (sent > 0 || failed > 0 || skipped > 0) {
          emitLiveActivity({
            kind: "schedule",
            status: failed > 0 ? "failed" : sent > 0 ? "sent" : "running",
            title: sent > 0 ? "Schedule progress" : failed > 0 ? "Schedule issue" : "Schedule update",
            message: `Processed ${ran} due schedule(s). Sent ${sent}, failed ${failed}, skipped ${skipped}.`,
            countText: sent > 0 ? `${sent} sent` : failed > 0 ? `${failed} failed` : `${skipped} skipped`,
            createdAt: new Date().toISOString(),
          });
        }
      }
    } finally {
      busyRef.current = false;
      setActive(false);
      releaseLock(workspaceId);
    }
  }

  async function syncInboundSilently(force = false) {
    if (!workspaceId || inboundBusyRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const lastRunKey = `${INBOUND_LAST_RUN_KEY}_${workspaceId}`;
    const lastRun = readNumber(lastRunKey);
    if (!force && lastRun && lastRun > now() - INBOUND_INTERVAL_MS) return;
    if (!acquireNamedLock(INBOUND_LOCK_KEY, workspaceId, INBOUND_LOCK_TTL_MS)) return;

    inboundBusyRef.current = true;
    window.localStorage.setItem(lastRunKey, String(now()));
    try {
      const response = await fetch("/api/gmail/auto-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          maxResults: 3,
          bounceMaxResults: 0,
          days: 2,
          accountLimit: 2,
          deadlineMs: 8000,
          newOnly: true,
          source: "v10_27_app_open_tiny_new_reply_pulse",
        }),
      });
      const json = (await response.json().catch(() => ({}))) as InboundSyncResponse;
      if (!response.ok || json?.success === false) return;

      const totals = json.totals || {};
      const important = Number(totals.realReplies || 0) + Number(totals.noInbox || 0) + Number(totals.blocked || 0) + Number(totals.bounced || 0) + Number(totals.limitNotices || 0);
      if (important > 0) {
        emitLiveActivity({
          kind: "schedule",
          status: "complete",
          title: "Replies synced",
          message: `Scout found ${Number(totals.realReplies || 0)} real repl${Number(totals.realReplies || 0) === 1 ? "y" : "ies"}, ${Number(totals.autoReplies || 0)} auto messages, and ${Number(totals.noInbox || 0) + Number(totals.blocked || 0) + Number(totals.bounced || 0)} delivery issue(s).`,
          createdAt: new Date().toISOString(),
        });
      }
      window.dispatchEvent(new CustomEvent("scout-notifications-refresh"));
    } finally {
      inboundBusyRef.current = false;
      releaseNamedLock(INBOUND_LOCK_KEY, workspaceId);
    }
  }

  async function decideStaleJob(action: "continue" | "pause") {
    if (!workspaceId || !staleJobsRef.current.length || recoveryBusy) return;
    const job = staleJobsRef.current[0];
    setRecoveryBusy(true);
    setRecoveryError("");
    try {
      const endpoint = action === "continue" ? "/api/message/continue-schedule" : "/api/message/stop-schedule";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, scheduleId: job.id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) {
        throw new Error(json?.error || `${action === "continue" ? "Continue" : "Pause"} failed with HTTP ${response.status}`);
      }

      const remaining = staleJobsRef.current.filter((item) => item.id !== job.id);
      updateStaleJobs(remaining);
      emitLiveActivity({
        kind: "schedule",
        status: action === "continue" ? "running" : "stopped",
        title: action === "continue" ? "Sending job continued" : "Sending job kept paused",
        message: action === "continue"
          ? "Scout will continue only the remaining recipients using the existing safety limits."
          : "The remaining recipients stay paused until you continue the job from Send Emails.",
        createdAt: new Date().toISOString(),
      });
      if (!remaining.length && action === "continue") {
        window.setTimeout(() => runDueSchedulesSilently().catch(() => undefined), 750);
      }
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : String(error));
    } finally {
      setRecoveryBusy(false);
    }
  }

  useEffect(() => {
    if (!workspaceId || typeof window === "undefined") return;
    staleCheckCompleteRef.current = false;
    updateStaleJobs([]);

    const bootstrap = async () => {
      const jobs = await checkForStaleJobs();
      if (!jobs.length) await runDueSchedulesSilently();
    };
    const first = window.setTimeout(() => bootstrap().catch(() => undefined), 1200);
    const firstInbound = window.setTimeout(() => syncInboundSilently().catch(() => undefined), 8000);
    const timer = window.setInterval(() => runDueSchedulesSilently().catch(() => undefined), RUN_INTERVAL_MS);
    const staleTimer = window.setInterval(() => checkForStaleJobs().catch(() => undefined), STALE_CHECK_INTERVAL_MS);
    const inboundTimer = window.setInterval(() => syncInboundSilently().catch(() => undefined), INBOUND_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(firstInbound);
      window.clearInterval(timer);
      window.clearInterval(staleTimer);
      window.clearInterval(inboundTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || typeof window === "undefined") return;
    const onFocus = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const jobs = await checkForStaleJobs();
      if (!jobs.length) await runDueSchedulesSilently();
      await syncInboundSilently();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const currentJob = staleJobs[0];
  const target = Number(currentJob?.target_count || 0);
  const processed = Number(currentJob?.processed_count || 0);
  const sent = Number(currentJob?.sent_count || 0);
  const remaining = Math.max(0, target - processed);

  return (
    <>
      {currentJob ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="stale-job-title">
          <div className="modal-card">
            <div className="topbar" style={{ marginBottom: 12 }}>
              <div className="page-title">
                <h2 id="stale-job-title">Continue this sending job?</h2>
                <p>Scout detected no progress for more than two hours.</p>
              </div>
              <span className="badge">Recovery check</span>
            </div>

            <div className="notice">
              Your internet may have gone offline, the browser may have closed, or the worker may have stopped. Scout has paused automatic continuation until you choose what to do.
            </div>

            <div className="grid grid-2" style={{ marginTop: 14 }}>
              <div className="card" style={{ padding: 14 }}>
                <div className="muted">Job</div>
                <strong>{currentJob.type === "follow_up" ? "Follow-up emails" : "Initial emails"}</strong>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div className="muted">No progress for</div>
                <strong>{hoursAndMinutes(Number(currentJob.staleForMinutes || 120))}</strong>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div className="muted">Progress</div>
                <strong>{processed.toLocaleString()} / {target.toLocaleString()}</strong>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div className="muted">Remaining</div>
                <strong>{remaining.toLocaleString()}</strong>
              </div>
            </div>

            <p className="muted" style={{ marginTop: 14 }}>
              {sent.toLocaleString()} already sent. Continuing keeps that progress and sends only to remaining eligible recipients. Scout still checks duplicates, replies, bounces, limits, and sender cooldowns.
            </p>
            {currentJob.last_error ? <div className="warning" style={{ marginTop: 12 }}>{currentJob.last_error}</div> : null}
            {recoveryError ? <div className="error" style={{ marginTop: 12 }}>{recoveryError}</div> : null}
            {staleJobs.length > 1 ? <p className="muted">After this decision, Scout will show the next interrupted job ({staleJobs.length - 1} more).</p> : null}

            <div className="actions" style={{ marginTop: 16 }}>
              <button className="btn" type="button" disabled={recoveryBusy} onClick={() => decideStaleJob("continue")}>
                {recoveryBusy ? "Working…" : "Continue remaining messages"}
              </button>
              <button className="btn secondary" type="button" disabled={recoveryBusy} onClick={() => decideStaleJob("pause")}>
                Keep paused
              </button>
              <a className="btn secondary" href="/message">Review job details</a>
            </div>
          </div>
        </div>
      ) : null}
      {active ? null : null}
    </>
  );
}
