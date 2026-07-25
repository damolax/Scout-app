import type { SupabaseClient } from '@supabase/supabase-js';
import { awardScoutingXp } from '@/lib/scouting-xp';

export type SenderHealthStage =
  | 'assessment'
  | 'healthy'
  | 'watch'
  | 'restricted'
  | 'critical'
  | 'strict_disabled'
  | 'recovering'
  | 'stable'
  | 'established'
  | 'proven'
  | 'paused';

export type SenderHealthEventType =
  | 'send_success'
  | 'permanent_bounce'
  | 'temporary_failure'
  | 'provider_limit'
  | 'message_blocked'
  | 'no_inbox'
  | 'seed_spam'
  | 'real_reply'
  | 'manual_pause'
  | 'manual_resume'
  | 'temporary_resume';

type AnyRow = Record<string, any>;
type IssueKind = 'provider_limit' | 'temporary_failure' | 'message_blocked' | 'permanent_bounce' | 'seed_spam';

const FORWARD_STAGES: SenderHealthStage[] = [
  'strict_disabled',
  'recovering',
  'critical',
  'restricted',
  'watch',
  'assessment',
  'healthy',
];

const DAY = 24 * 60 * 60 * 1000;
const ISSUE_WINDOW_MS = 14 * DAY;

const ISSUE_POLICIES: Record<IssueKind, {
  label: string;
  ordinaryPauseMs: number | null;
  hardRestrictionMs: number | null;
  recoveringCap: number;
}> = {
  provider_limit: {
    label: 'Gmail provider sending limit',
    ordinaryPauseMs: DAY,
    hardRestrictionMs: 7 * DAY,
    recoveringCap: 25,
  },
  temporary_failure: {
    label: 'Repeated temporary delivery failures',
    ordinaryPauseMs: null,
    hardRestrictionMs: null,
    recoveringCap: 50,
  },
  message_blocked: {
    label: 'Messages blocked by Gmail or the receiving provider',
    ordinaryPauseMs: null,
    hardRestrictionMs: null,
    recoveringCap: 50,
  },
  permanent_bounce: {
    label: 'Permanent bounces / invalid recipient list',
    ordinaryPauseMs: null,
    hardRestrictionMs: null,
    recoveringCap: 25,
  },
  seed_spam: {
    label: 'Repeated seed tests landing in Spam',
    ordinaryPauseMs: DAY,
    hardRestrictionMs: 7 * DAY,
    recoveringCap: 25,
  },
};

export function deploymentDailyCap() {
  const parsed = Number(process.env.SCOUT_DEPLOYMENT_DAILY_CAP || 250);
  if (!Number.isFinite(parsed)) return 250;
  return Math.max(1, Math.min(250, Math.floor(parsed)));
}

export function deploymentRunCap() {
  const parsed = Number(process.env.SCOUT_DEPLOYMENT_RUN_CAP || deploymentDailyCap());
  if (!Number.isFinite(parsed)) return deploymentDailyCap();
  return Math.max(1, Math.min(deploymentDailyCap(), Math.floor(parsed)));
}

export function assessmentCheckpointCap(_successfulSends: number, deploymentCap = deploymentDailyCap()) {
  return Math.max(1, Math.min(deploymentCap, 250));
}

export function stageCap(stage: string, _successfulSends = 0, deploymentCap = deploymentDailyCap(), recoveryStep = 0) {
  const normalized = String(stage || 'assessment').toLowerCase() as SenderHealthStage;
  const recoveryCaps = [25, 50, 100, 175, 250];
  const caps: Record<SenderHealthStage, number> = {
    assessment: 250,
    healthy: 250,
    watch: 175,
    restricted: 100,
    critical: 50,
    strict_disabled: 0,
    recovering: recoveryCaps[Math.max(0, Math.min(recoveryCaps.length - 1, Number(recoveryStep || 0)))],
    stable: 175,
    established: 250,
    proven: 250,
    paused: 0,
  };
  return Math.max(0, Math.min(deploymentCap, caps[normalized] ?? 250));
}

function overrideIsActive(account: AnyRow) {
  if (!account.owner_override_active || account.owner_override_locked) return false;
  if (!account.owner_override_until) return true;
  return new Date(account.owner_override_until).getTime() > Date.now();
}

export function effectiveDailyLimit(account: AnyRow) {
  const deploymentCap = Math.max(1, Math.min(250, Number(account.deployment_cap || deploymentDailyCap())));
  if (String(account.health_stage || '').toLowerCase() === 'strict_disabled' || account.owner_override_locked || account.hard_restriction_active) return 0;
  if (String(account.health_stage || '').toLowerCase() === 'paused' || account.is_paused === true) return 0;
  const recommended = Math.max(0, Math.min(deploymentCap, Number(
    account.health_recommended_limit ?? account.health_cap ?? stageCap(account.health_stage, account.successful_sends, deploymentCap, account.recovery_step)
  )));
  const healthCeiling = overrideIsActive(account)
    ? Math.max(0, Math.min(deploymentCap, Number(account.owner_override_limit || recommended)))
    : recommended;
  const ownerDaily = Math.max(1, Math.min(deploymentCap, Number(account.daily_limit || deploymentCap)));
  return Math.max(0, Math.min(deploymentCap, healthCeiling, ownerDaily));
}

export function effectiveRunLimit(account: AnyRow) {
  const daily = effectiveDailyLimit(account);
  const ownerDefaultRun = Math.max(1, Number(account.default_run_limit || 100));
  return Math.max(0, Math.min(daily, ownerDefaultRun, deploymentRunCap()));
}

export function randomSenderCooldownSeconds() {
  return 90 + Math.floor(Math.random() * 121);
}

export function randomWorkspaceDispatchGapSeconds() {
  return 3 + Math.floor(Math.random() * 4);
}

export function issuePolicy(kind: string) {
  return ISSUE_POLICIES[kind as IssueKind] || null;
}

function pauseWarning(account: AnyRow) {
  return String(account.paused_reason || account.health_reason || account.last_error || 'Scout paused this Gmail account for safety.');
}

function oneStepUp(current: SenderHealthStage, candidate: SenderHealthStage) {
  if (candidate === 'restricted' || candidate === 'paused') return candidate;
  const currentIndex = FORWARD_STAGES.indexOf(current);
  const candidateIndex = FORWARD_STAGES.indexOf(candidate);
  if (candidateIndex < 0 || currentIndex < 0 || candidateIndex <= currentIndex) return candidate;
  return FORWARD_STAGES[Math.min(candidateIndex, currentIndex + 1)];
}

function issueKindFromEvent(eventType: SenderHealthEventType): IssueKind | null {
  if (eventType === 'provider_limit') return 'provider_limit';
  if (eventType === 'temporary_failure') return 'temporary_failure';
  if (eventType === 'message_blocked') return 'message_blocked';
  if (eventType === 'permanent_bounce') return 'permanent_bounce';
  if (eventType === 'seed_spam') return 'seed_spam';
  return null;
}

function issueStrike(account: AnyRow, kind: IssueKind, nowMs: number) {
  const sameIssue = String(account.pause_issue_key || '') === kind;
  const windowStartMs = account.pause_issue_window_started_at
    ? new Date(account.pause_issue_window_started_at).getTime()
    : 0;
  const withinWindow = sameIssue && windowStartMs > 0 && nowMs - windowStartMs <= ISSUE_WINDOW_MS;
  return {
    count: withinWindow ? Number(account.pause_issue_count || 0) + 1 : 1,
    windowStartedAt: new Date(withinWindow ? windowStartMs : nowMs).toISOString(),
    windowEndsAt: new Date((withinWindow ? windowStartMs : nowMs) + ISSUE_WINDOW_MS).toISOString(),
  };
}

function formatRestrictionDuration(ms: number | null) {
  if (ms === null) return 'until the recipient list is cleaned';
  const days = Math.round(ms / DAY);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.round(ms / (60 * 60 * 1000));
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

function issuePausePatch(account: AnyRow, kind: IssueKind, reason: string, nowMs = Date.now()) {
  const policy = ISSUE_POLICIES[kind];
  const strike = issueStrike(account, kind, nowMs);
  const hardRestricted = strike.count >= 3;
  const hardUntil = hardRestricted && policy.hardRestrictionMs !== null
    ? new Date(nowMs + policy.hardRestrictionMs).toISOString()
    : null;
  const ordinaryUntil = !hardRestricted && policy.ordinaryPauseMs !== null
    ? new Date(nowMs + policy.ordinaryPauseMs).toISOString()
    : null;
  const baseReason = reason || policy.label;
  const consequence = hardRestricted
    ? `This is occurrence 3 within 14 days. Scout hard-restricted this Gmail ${formatRestrictionDuration(policy.hardRestrictionMs)}.`
    : `This is occurrence ${strike.count} of 3 within the current 14-day issue window. The user may resume after acknowledging this warning; the same issue will pause it again.`;

  return {
    health_stage: 'restricted' as SenderHealthStage,
    health_cap: 0,
    health_reason: `${baseReason} ${consequence}`,
    is_paused: true,
    status: kind === 'provider_limit' ? 'limit_hit' : 'paused',
    pause_kind: kind,
    paused_until: hardRestricted ? hardUntil : ordinaryUntil,
    paused_reason: `${baseReason} ${consequence}`,
    safety_override_active: false,
    safety_override_until: null,
    safety_override_warning: null,
    pause_issue_key: kind,
    pause_issue_count: strike.count,
    pause_issue_window_started_at: strike.windowStartedAt,
    pause_issue_window_ends_at: strike.windowEndsAt,
    pause_issue_last_at: new Date(nowMs).toISOString(),
    hard_restriction_active: hardRestricted,
    hard_restricted_until: hardUntil,
    hard_restriction_reason: hardRestricted ? `${policy.label}: repeated 3 times within 14 days.` : null,
    hard_restriction_count: hardRestricted ? Number(account.hard_restriction_count || 0) + 1 : Number(account.hard_restriction_count || 0),
    updated_at: new Date(nowMs).toISOString(),
    last_health_review_at: new Date(nowMs).toISOString(),
  };
}

export async function recordSenderHealthEvent(
  supabase: SupabaseClient<any, any, any>,
  input: {
    workspaceId: string;
    gmailAccountId: string;
    eventType: SenderHealthEventType;
    reason?: string;
    recipient?: string;
    raw?: Record<string, unknown>;
  },
) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  await supabase.from('sender_health_events').insert({
    workspace_id: input.workspaceId,
    gmail_account_id: input.gmailAccountId,
    event_type: input.eventType,
    reason: input.reason || null,
    recipient_email: input.recipient || null,
    raw: input.raw || {},
    created_at: now,
  });

  const eventKey = String((input.raw || {}).event_key || `${input.eventType}:${input.gmailAccountId}:${input.recipient || ''}:${now}`);
  if (input.eventType === 'send_success') {
    await awardScoutingXp(supabase, { workspaceId: input.workspaceId, eventType: 'clean_message_delivered', points: 1, uniqueEventKey: `sender-event:${eventKey}`, entityType: 'gmail_account', entityId: input.gmailAccountId }).catch(() => undefined);
  } else if (input.eventType === 'real_reply') {
    await awardScoutingXp(supabase, { workspaceId: input.workspaceId, eventType: 'real_reply', points: 1500, uniqueEventKey: `sender-event:${eventKey}`, entityType: 'gmail_account', entityId: input.gmailAccountId }).catch(() => undefined);
  }

  const { data: account } = await supabase
    .from('gmail_accounts')
    .select('*')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.gmailAccountId)
    .maybeSingle();
  if (!account) return null;

  const patch: AnyRow = { updated_at: now, last_health_review_at: now };
  const overrideWasActive = Boolean(account.safety_override_active);
  const currentStage = String(account.health_stage || 'assessment') as SenderHealthStage;
  const issueKind = issueKindFromEvent(input.eventType);

  if (input.eventType === 'provider_limit') {
    Object.assign(patch, issuePausePatch(account, 'provider_limit', input.reason || 'Gmail provider limit detected.', nowMs));
    patch.provider_limit_events = Number(account.provider_limit_events || 0) + 1;
    patch.last_provider_limit_at = now;
    patch.clean_since = now;
  } else if (input.eventType === 'permanent_bounce') {
    patch.permanent_bounces = Number(account.permanent_bounces || 0) + 1;
    patch.health_reason = input.reason || 'Permanent delivery failure detected.';
  } else if (input.eventType === 'temporary_failure') {
    patch.temporary_failures = Number(account.temporary_failures || 0) + 1;
    patch.health_reason = input.reason || 'Temporary delivery failure detected.';
  } else if (input.eventType === 'message_blocked') {
    patch.blocked_events = Number(account.blocked_events || 0) + 1;
    patch.health_reason = input.reason || 'Message was blocked by Gmail or the receiving provider.';
  } else if (input.eventType === 'no_inbox') {
    patch.health_reason = input.reason || 'Recipient has no usable inbox or the address was rejected.';
  } else if (input.eventType === 'seed_spam') {
    patch.health_reason = input.reason || 'A seed placement test landed in Spam.';
  } else if (input.eventType === 'real_reply') {
    patch.real_replies = Number(account.real_replies || 0) + 1;
  } else if (input.eventType === 'manual_pause') {
    Object.assign(patch, {
      health_stage: 'paused',
      health_cap: 0,
      is_paused: true,
      status: 'paused',
      pause_kind: 'manual',
      paused_until: null,
      paused_reason: input.reason || 'Paused manually.',
      health_reason: input.reason || 'Paused manually.',
      safety_override_active: false,
      safety_override_until: null,
      safety_override_warning: null,
    });
  } else if (input.eventType === 'manual_resume') {
    Object.assign(patch, {
      health_stage: currentStage === 'paused' ? 'assessment' : currentStage,
      health_cap: stageCap(currentStage === 'paused' ? 'assessment' : currentStage, Number(account.successful_sends || 0), Number(account.deployment_cap || deploymentDailyCap())),
      is_paused: false,
      status: 'connected',
      pause_kind: null,
      paused_until: null,
      paused_reason: null,
      safety_override_active: false,
      safety_override_until: null,
      safety_override_warning: null,
      health_reason: 'Manual pause ended by the user.',
    });
  } else if (input.eventType === 'temporary_resume') {
    const warning = input.reason || pauseWarning(account);
    Object.assign(patch, {
      is_paused: false,
      status: 'connected',
      health_stage: 'recovering',
      health_cap: Math.min(Number(account.deployment_cap || deploymentDailyCap()), 50),
      safety_override_active: true,
      safety_override_until: null,
      safety_override_warning: warning,
      safety_override_acknowledged_at: now,
      health_reason: `Resumed with warning. Original reason: ${warning}`,
    });
  }

  // v10.42: ordinary failures during an owner override are evaluated by active sending day.
  // They do not immediately hard-disable the account. Provider-limit events remain an emergency stop.

  await supabase
    .from('gmail_accounts')
    .update(patch)
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.gmailAccountId);

  if (!overrideWasActive && ['permanent_bounce', 'temporary_failure', 'message_blocked', 'seed_spam', 'real_reply'].includes(input.eventType)) {
    const { data: updated } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('workspace_id', input.workspaceId)
      .eq('id', input.gmailAccountId)
      .maybeSingle();
    if (updated) return reviewSenderHealth(supabase, updated);
  }

  return patch;
}

export async function reviewSenderHealth(
  supabase: SupabaseClient<any, any, any>,
  account: AnyRow,
) {
  const accountId = String(account.id);
  const workspaceId = String(account.workspace_id);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const nowIso = now.toISOString();
  const since7d = new Date(now.getTime() - 7 * DAY).toISOString();
  const deploymentCap = Math.max(1, Math.min(250, Number(account.deployment_cap || deploymentDailyCap())));

  if (String(account.pause_kind || '') === 'manual' && account.is_paused) {
    return { health_stage: 'paused', health_cap: 0, health_recommended_limit: 0, is_paused: true, status: 'paused' };
  }

  const { data: events, error: eventError } = await supabase
    .from('sender_health_events')
    .select('event_type,created_at')
    .eq('workspace_id', workspaceId)
    .eq('gmail_account_id', accountId)
    .gte('created_at', since7d)
    .order('created_at', { ascending: true })
    .limit(10000);
  if (eventError) throw eventError;

  const rows = (events || []) as AnyRow[];
  const byDay = new Map<string, AnyRow>();
  for (const event of rows) {
    const day = String(event.created_at || '').slice(0, 10);
    if (!day) continue;
    const metric = byDay.get(day) || { day, success: 0, permanent: 0, temporary: 0, blocked: 0, noInbox: 0, provider: 0, replies: 0 };
    if (event.event_type === 'send_success') metric.success += 1;
    if (event.event_type === 'permanent_bounce') metric.permanent += 1;
    if (event.event_type === 'temporary_failure') metric.temporary += 1;
    if (event.event_type === 'message_blocked') metric.blocked += 1;
    if (event.event_type === 'no_inbox') metric.noInbox += 1;
    if (event.event_type === 'provider_limit') metric.provider += 1;
    if (event.event_type === 'real_reply') metric.replies += 1;
    byDay.set(day, metric);
  }

  const dailyRows: AnyRow[] = [...byDay.values()].map((metric: AnyRow) => {
    const attempts = metric.success + metric.permanent + metric.temporary + metric.blocked + metric.noInbox;
    const divisor = Math.max(1, attempts);
    const permanentRate = metric.permanent / divisor;
    const blockedRate = metric.blocked / divisor;
    const noInboxRate = metric.noInbox / divisor;
    const temporaryRate = metric.temporary / divisor;
    const score = Math.max(0, Math.min(100,
      100
      - permanentRate * 800
      - blockedRate * 1000
      - noInboxRate * 800
      - temporaryRate * 300
      - (metric.provider > 0 ? 25 : 0)
      + Math.min(5, metric.replies * 2)
      + (attempts >= 50 && permanentRate < 0.01 && blockedRate < 0.01 && noInboxRate < 0.03 && temporaryRate < 0.05 && metric.provider === 0 ? 5 : 0)
    ));
    const harmful = attempts >= 50 && (
      permanentRate >= 0.05 || blockedRate >= 0.05 || noInboxRate >= 0.10 || temporaryRate >= 0.15 || score < 45
    ) || metric.provider > 0;
    return { ...metric, attempts, permanentRate, blockedRate, noInboxRate, temporaryRate, score, harmful };
  });

  for (const metric of dailyRows) {
    await supabase.from('sender_health_daily').upsert({
      workspace_id: workspaceId,
      gmail_account_id: accountId,
      active_day: metric.day,
      attempted_count: metric.attempts,
      success_count: metric.success,
      permanent_bounce_count: metric.permanent,
      temporary_failure_count: metric.temporary,
      blocked_count: metric.blocked,
      no_inbox_count: metric.noInbox,
      provider_limit_count: metric.provider,
      real_reply_count: metric.replies,
      health_score: metric.score,
      harmful: metric.harmful,
      override_active: Boolean(account.owner_override_active),
      metrics: metric,
      assessed_at: nowIso,
    }, { onConflict: 'gmail_account_id,active_day' });
  }

  const activeDays = dailyRows.filter((row) => row.attempts >= 50);
  const todayMetrics = dailyRows.find((row) => row.day === today) || {
    day: today, attempts: 0, success: 0, permanent: 0, temporary: 0, blocked: 0, noInbox: 0, provider: 0,
    replies: 0, permanentRate: 0, blockedRate: 0, noInboxRate: 0, temporaryRate: 0, score: Number(account.health_score || 100), harmful: false,
  };
  const totalAttempts = activeDays.reduce((sum, row) => sum + row.attempts, 0);
  const reliability = totalAttempts >= 150 ? 'reliable' : totalAttempts >= 50 ? 'limited' : 'insufficient_evidence';
  const overrideActive = Boolean(account.owner_override_active)
    && !account.owner_override_locked
    && (!account.owner_override_until || new Date(account.owner_override_until).getTime() > now.getTime());

  let stage = String(account.health_stage || 'assessment') as SenderHealthStage;
  let recommended = Number(account.health_recommended_limit ?? account.health_cap ?? 250);
  let reason = 'Delivery health is within the current thresholds.';
  let strict = stage === 'strict_disabled' || Boolean(account.owner_override_locked) || Boolean(account.hard_restriction_active);
  let harmfulStreak = Number(account.harmful_override_streak || 0);
  let recoveryStep = Number(account.recovery_step || 0);
  let lastRecoveryDay = account.last_recovery_progress_day || null;

  const severeNow = todayMetrics.provider > 0 || (todayMetrics.attempts >= 50 && (todayMetrics.permanentRate >= 0.10 || todayMetrics.blockedRate >= 0.10));
  if (severeNow) {
    strict = true;
    stage = 'strict_disabled';
    recommended = 0;
    reason = todayMetrics.provider > 0
      ? 'Gmail/provider sending-limit event detected. Scout strictly disabled this sender.'
      : 'A severe delivery-failure rate triggered an emergency strict disable.';
  } else if (strict) {
    const strictAt = account.strict_disabled_at ? new Date(account.strict_disabled_at).getTime() : now.getTime();
    const cleanWindow = dailyRows.filter((row) => new Date(`${row.day}T00:00:00Z`).getTime() >= strictAt).every((row) => !row.harmful && row.provider === 0);
    const passiveDays = (now.getTime() - strictAt) / DAY;
    if (passiveDays >= 3 && cleanWindow) {
      strict = false;
      stage = 'recovering';
      recoveryStep = 0;
      recommended = 25;
      harmfulStreak = 0;
      reason = 'Health conditions passed the automatic recovery check. Scout unlocked this sender at 25/day.';
    } else {
      stage = 'strict_disabled';
      recommended = 0;
      reason = account.hard_restriction_reason || account.health_reason || 'Strict disable remains active while Scout waits for a clean recovery window.';
    }
  } else if (todayMetrics.harmful) {
    if (overrideActive && account.last_harmful_override_day !== today) harmfulStreak += 1;
    if (overrideActive && harmfulStreak >= 3) {
      strict = true;
      stage = 'strict_disabled';
      recommended = 0;
      reason = 'Unhealthy delivery continued for three active sending days after the owner overrode Scout. Owner overrides are now locked.';
    } else if (todayMetrics.score < 25) {
      stage = 'critical'; recommended = 50; reason = `Health score ${todayMetrics.score.toFixed(0)} requires a 50/day recommendation.`;
    } else if (todayMetrics.score < 45) {
      stage = 'critical'; recommended = 50; reason = `Health score ${todayMetrics.score.toFixed(0)} requires Critical monitoring.`;
    } else if (todayMetrics.score < 65) {
      stage = 'restricted'; recommended = 100; reason = `Health score ${todayMetrics.score.toFixed(0)} requires a 100/day recommendation.`;
    } else {
      stage = 'watch'; recommended = 175; reason = `Health score ${todayMetrics.score.toFixed(0)} placed this sender on Watch.`;
    }
  } else if (stage === 'recovering') {
    const cleanActiveToday = todayMetrics.attempts >= 50 && !todayMetrics.harmful;
    if (cleanActiveToday && lastRecoveryDay !== today) {
      recoveryStep = Math.min(4, recoveryStep + 1);
      lastRecoveryDay = today;
    }
    recommended = [25, 50, 100, 175, 250][Math.max(0, Math.min(4, recoveryStep))];
    stage = recoveryStep >= 4 ? 'healthy' : 'recovering';
    reason = recoveryStep >= 4
      ? 'Five clean recovery checkpoints restored this sender to 250/day.'
      : `Recovery checkpoint ${recoveryStep + 1} of 5. Current recommendation: ${recommended}/day.`;
  } else {
    harmfulStreak = 0;
    if (reliability === 'insufficient_evidence') {
      stage = 'assessment'; recommended = 250; reason = 'Newly connected sender is being assessed at a 250/day system ceiling.';
    } else if (todayMetrics.score >= 80) {
      stage = 'healthy'; recommended = 250; reason = `Health score ${todayMetrics.score.toFixed(0)} supports the full 250/day ceiling.`;
    } else if (todayMetrics.score >= 65) {
      stage = 'watch'; recommended = 175; reason = `Health score ${todayMetrics.score.toFixed(0)} supports a 175/day recommendation.`;
    } else if (todayMetrics.score >= 45) {
      stage = 'restricted'; recommended = 100; reason = `Health score ${todayMetrics.score.toFixed(0)} supports a 100/day recommendation.`;
    } else {
      stage = 'critical'; recommended = 50; reason = `Health score ${todayMetrics.score.toFixed(0)} supports a 50/day recommendation.`;
    }
  }

  recommended = Math.max(0, Math.min(deploymentCap, recommended));
  const stageChanged = stage !== String(account.health_stage || 'assessment');
  const limitChanged = recommended !== Number(account.health_recommended_limit ?? account.health_cap ?? 250);
  const patch: AnyRow = {
    health_stage: stage,
    health_cap: recommended,
    health_recommended_limit: recommended,
    health_score: Number(todayMetrics.score.toFixed(2)),
    health_reliability: reliability,
    health_reason: reason,
    last_health_metrics: todayMetrics,
    harmful_override_streak: harmfulStreak,
    last_harmful_override_day: overrideActive && todayMetrics.harmful ? today : account.last_harmful_override_day,
    recovery_step: recoveryStep,
    last_recovery_progress_day: lastRecoveryDay,
    owner_override_active: strict ? false : overrideActive,
    owner_override_locked: strict,
    strict_disabled_at: strict ? (account.strict_disabled_at || nowIso) : null,
    hard_restriction_active: strict,
    is_paused: strict,
    status: strict ? 'paused' : 'connected',
    last_health_review_at: nowIso,
    updated_at: nowIso,
  };
  if (strict) {
    patch.owner_override_until = null;
    patch.owner_override_limit = null;
  }
  if (stageChanged) patch.last_stage_change_at = nowIso;

  await supabase.from('gmail_accounts').update(patch).eq('workspace_id', workspaceId).eq('id', accountId);

  if (stageChanged || limitChanged || strict) {
    await supabase.from('sender_limit_audit').insert({
      workspace_id: workspaceId,
      gmail_account_id: accountId,
      previous_stage: account.health_stage || 'assessment',
      new_stage: stage,
      previous_recommended_limit: Number(account.health_recommended_limit ?? account.health_cap ?? 250),
      new_recommended_limit: recommended,
      owner_daily_limit: Number(account.daily_limit || 250),
      owner_override_limit: overrideActive ? Number(account.owner_override_limit || 0) : null,
      action: strict ? 'strict_disable_or_hold' : stageChanged ? 'automatic_stage_change' : 'automatic_limit_change',
      reason,
      metrics: todayMetrics,
      created_at: nowIso,
    });
  }

  return patch;
}

