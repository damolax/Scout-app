"use client";

import { useEffect, useRef, useState } from "react";
import { emitLiveActivity } from "@/lib/live-activity-client";

const LOCK_KEY = "scout_v10_open_app_runner_lock";
const LAST_RUN_KEY = "scout_v10_open_app_runner_last_run";
const RUN_INTERVAL_MS = 20_000;
const LOCK_TTL_MS = 45_000;

type RunnerResponse = {
  success?: boolean;
  ran?: number;
  results?: Array<{ sent?: number; failed?: number; skipped?: number }>;
  error?: string;
};

function now() {
  return Date.now();
}

function readNumber(key: string) {
  if (typeof window === "undefined") return 0;
  const value = Number(window.localStorage.getItem(key) || "0");
  return Number.isFinite(value) ? value : 0;
}

function acquireLock(workspaceId: string) {
  if (typeof window === "undefined") return false;
  const key = `${LOCK_KEY}_${workspaceId}`;
  const current = readNumber(key);
  if (current && current > now() - LOCK_TTL_MS) return false;
  window.localStorage.setItem(key, String(now()));
  return true;
}

function releaseLock(workspaceId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`${LOCK_KEY}_${workspaceId}`);
}

export function AppOpenRunner({ workspaceId }: { workspaceId?: string | null }) {
  const [active, setActive] = useState(false);
  const busyRef = useRef(false);

  async function runDueSchedulesSilently() {
    if (!workspaceId || busyRef.current) return;
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
          targetLimit: 25,
          senderRunLimit: 25,
          source: "v10_global_open_app_runner",
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
        emitLiveActivity({
          kind: "schedule",
          status: "running",
          title: "Due schedule running",
          message: `Open app runner processed ${ran} due schedule(s). Sent ${sent}, failed ${failed}, skipped ${skipped}.`,
          countText: `${sent} sent`,
          createdAt: new Date().toISOString(),
        });
      }
    } finally {
      busyRef.current = false;
      setActive(false);
      releaseLock(workspaceId);
    }
  }

  useEffect(() => {
    if (!workspaceId || typeof window === "undefined") return;
    const tick = () => runDueSchedulesSilently().catch(() => undefined);
    const first = window.setTimeout(tick, 5000);
    const timer = window.setInterval(tick, RUN_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || typeof window === "undefined") return;
    const onFocus = () => runDueSchedulesSilently().catch(() => undefined);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  if (!active) return null;
  return null;
}
