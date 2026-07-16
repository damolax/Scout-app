import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase-admin';
import { configuredRunLimit, effectiveDailyLimit } from '@/lib/sending-safety';

type AnyRow = Record<string, any>;

export type ReservedSenderSlot = {
  id: string | null;
  runId: string;
  allowed: boolean;
  reason: string;
  sentToday: number;
  sentRolling24h: number;
};

export async function reserveSingleSenderSlot(
  admin: ReturnType<typeof createAdminClient>,
  options: { workspaceId: string; account: AnyRow; runId?: string; batchId?: string; runLimit?: number; timezone?: string },
): Promise<ReservedSenderSlot> {
  const runId = options.runId || randomUUID();
  const daily = Math.max(1, Math.min(2000, Number(options.account.daily_limit || 250)));
  const effective = Math.max(0, effectiveDailyLimit(options.account));
  const runLimit = Math.max(1, Math.min(250, Number(options.runLimit || configuredRunLimit(options.account) || 50)));
  if (!effective) return { id: null, runId, allowed: false, reason: 'Sender health or warm-up allowance is paused.', sentToday: 0, sentRolling24h: 0 };

  const { data, error } = await admin.rpc('reserve_scout_sender_slot', {
    p_workspace_id: options.workspaceId,
    p_gmail_account_id: String(options.account.id),
    p_schedule_id: runId,
    p_batch_id: options.batchId || `direct_${runId}`,
    p_timezone: options.timezone || 'UTC',
    p_daily_limit: daily,
    p_effective_limit: effective,
    p_run_limit: runLimit,
  });
  if (error) {
    const text = String(error.message || '').toLowerCase();
    if (text.includes('reserve_scout_sender_slot') || text.includes('pgrst202') || text.includes('schema cache')) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await admin.from('sent_messages').select('id', { count: 'exact', head: true }).eq('workspace_id', options.workspaceId).eq('gmail_account_id', options.account.id).eq('status', 'sent').gte('sent_at', since);
      const rolling = Number(count || 0);
      return { id: null, runId, allowed: rolling < Math.min(daily, effective), reason: rolling < Math.min(daily, effective) ? 'Fallback safety check.' : 'Rolling 24-hour safe limit reached.', sentToday: Number(options.account.sent_today || 0), sentRolling24h: rolling };
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { id: row?.reservation_id ? String(row.reservation_id) : null, runId, allowed: Boolean(row?.allowed), reason: String(row?.reason || ''), sentToday: Number(row?.sent_today || 0), sentRolling24h: Number(row?.sent_rolling_24h || 0) };
}

export async function finalizeSingleSenderSlot(admin: ReturnType<typeof createAdminClient>, id: string | null, success: boolean, error?: string) {
  if (!id) return;
  await admin.rpc('finalize_scout_sender_slot', { p_reservation_id: id, p_success: success, p_error: error || null });
}
