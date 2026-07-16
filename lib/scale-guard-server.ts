import { createAdminClient } from "@/lib/supabase-admin";

export type SenderLaneLease = {
  allowed: boolean;
  token: string | null;
  slot: number | null;
  reason: string;
};

const PLATFORM_LIMIT = Math.max(
  1,
  Math.min(500, Number(process.env.SCOUT_MAX_ACTIVE_SENDER_LANES || 12)),
);
const WORKSPACE_LIMIT = Math.max(
  1,
  Math.min(
    50,
    Number(process.env.SCOUT_MAX_ACTIVE_SENDER_LANES_PER_WORKSPACE || 2),
  ),
);

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function acquireDirectSenderLane(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  gmailAccountId: string,
  options?: { attempts?: number; waitMs?: number },
): Promise<SenderLaneLease> {
  const attempts = Math.max(1, Math.min(15, Number(options?.attempts || 6)));
  const waitMs = Math.max(250, Math.min(5_000, Number(options?.waitMs || 1_000)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { data, error } = await supabase.rpc("acquire_scout_sender_lane", {
      p_workspace_id: workspaceId,
      p_schedule_id: null,
      p_gmail_account_id: gmailAccountId,
      p_platform_limit: PLATFORM_LIMIT,
      p_workspace_limit: WORKSPACE_LIMIT,
      p_lease_seconds: 120,
    });
    if (error) {
      throw new Error(
        `Scale Guard sender lease failed: ${errorText(error)}. Run RUN_THIS_SQL_FIRST_V10_35_1_SCALE_GUARD.sql.`,
      );
    }
    const row = Array.isArray(data) ? data[0] : data;
    const lease: SenderLaneLease = {
      allowed: Boolean(row?.allowed),
      token: row?.lease_token ? String(row.lease_token) : null,
      slot: row?.slot == null ? null : Number(row.slot),
      reason: String(row?.reason || ""),
    };
    if (lease.allowed || attempt === attempts) return lease;
    await sleep(waitMs);
  }

  return {
    allowed: false,
    token: null,
    slot: null,
    reason: "Platform sender capacity is busy.",
  };
}

export async function releaseDirectSenderLane(
  supabase: ReturnType<typeof createAdminClient>,
  token: string | null,
) {
  if (!token) return;
  await supabase.rpc("release_scout_sender_lane", { p_lease_token: token });
}
