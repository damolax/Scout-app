export type SendingMode = 'warmup' | 'normal' | 'fast';
export type SenderHealth = 'new' | 'warming' | 'healthy' | 'recovering' | 'at_risk' | 'sender_limited' | 'paused' | 'needs_review';

type AnyRow = Record<string, any>;

const DAY = 24 * 60 * 60 * 1000;
const WARMUP_RAMP = [5, 8, 10, 15, 20, 25, 35, 40, 45, 50];

export function sendingMode(account: AnyRow): SendingMode {
  const raw = String(account?.sending_mode || account?.raw?.sending_mode || '').trim().toLowerCase();
  if (raw === 'warmup' || raw === 'fast') return raw;
  return 'normal';
}

export function senderHealth(account: AnyRow): SenderHealth {
  const status = String(account?.health_status || account?.raw?.health_status || '').trim().toLowerCase();
  const providerStatus = String(account?.status || '').trim().toLowerCase();
  if (['limit_hit', 'sender_limited'].includes(providerStatus)) return 'sender_limited';
  if (['paused', 'blocked'].includes(providerStatus) || account?.is_paused === true) return 'paused';
  if (['new', 'warming', 'healthy', 'recovering', 'at_risk', 'sender_limited', 'paused', 'needs_review'].includes(status)) {
    return status as SenderHealth;
  }
  const created = account?.created_at ? new Date(account.created_at).getTime() : 0;
  return created && Date.now() - created < 7 * DAY ? 'new' : 'needs_review';
}

export function warmupDay(account: AnyRow) {
  const started = account?.warmup_started_at || account?.raw?.warmup_started_at || account?.created_at;
  const timestamp = started ? new Date(started).getTime() : Date.now();
  if (!Number.isFinite(timestamp)) return 1;
  return Math.max(1, Math.floor((Date.now() - timestamp) / DAY) + 1);
}

export function warmupAllowance(account: AnyRow) {
  const manual = Number(account?.warmup_daily_cap || account?.raw?.warmup_daily_cap || 0);
  if (Number.isFinite(manual) && manual > 0) return Math.floor(manual);
  const index = Math.min(WARMUP_RAMP.length - 1, warmupDay(account) - 1);
  return WARMUP_RAMP[index];
}

export function configuredDailyLimit(account: AnyRow) {
  const value = Number(account?.daily_limit || 250);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 250;
}

export function configuredRunLimit(account: AnyRow) {
  const value = Number(account?.default_run_limit || 50);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 50;
}

export function healthAllowance(account: AnyRow) {
  const health = senderHealth(account);
  if (health === 'sender_limited' || health === 'paused') return 0;
  if (health === 'new' || health === 'warming') return warmupAllowance(account);
  if (health === 'recovering') return Math.min(15, warmupAllowance(account));
  if (health === 'at_risk') return 10;
  if (health === 'needs_review') return 25;
  return Number.POSITIVE_INFINITY;
}

export function effectiveDailyLimit(account: AnyRow) {
  const configured = configuredDailyLimit(account);
  const mode = sendingMode(account);
  const modeAllowance = mode === 'warmup' ? warmupAllowance(account) : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(Math.min(configured, modeAllowance, healthAllowance(account))));
}

export function delayRangeMs(account: AnyRow) {
  const mode = sendingMode(account);
  const health = senderHealth(account);
  if (mode === 'warmup') return { min: 60_000, max: 180_000 };
  // Fast mode is deliberately unavailable until a controlled placement test
  // or later health evaluation marks the account healthy.
  if (mode === 'fast' && health === 'healthy') return { min: 3_000, max: 3_000 };
  return { min: 15_000, max: 45_000 };
}

export function nextDelayMs(account: AnyRow) {
  const range = delayRangeMs(account);
  if (range.min === range.max) return range.min;
  return Math.floor(range.min + Math.random() * (range.max - range.min + 1));
}

export function modeLabel(mode: SendingMode) {
  if (mode === 'warmup') return 'Warm-up / Recovery';
  if (mode === 'fast') return 'Fast';
  return 'Normal';
}

export function healthLabel(health: SenderHealth) {
  return health.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
