"use client";

/**
 * Scout v10.35.1 Scale Guard
 *
 * Scheduled work is claimed by the central Render worker. The browser no longer polls Supabase every five seconds and
 * no longer calls Gmail reply-sync endpoints while restricted Gmail scopes are
 * disabled. Keeping this component in the layout preserves the existing app
 * structure without adding any user-facing setup or breaking imports.
 */
export function AppOpenRunner({ workspaceId: _workspaceId }: { workspaceId?: string | null }) {
  return null;
}
