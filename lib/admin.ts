export const SCOUT_ADMIN_EMAIL = 'oyekunleolalekan3168@gmail.com';

export function isScoutAdminEmail(email?: string | null) {
  return String(email || '').trim().toLowerCase() === SCOUT_ADMIN_EMAIL;
}
