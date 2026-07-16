import { createClient } from '@/lib/supabase-server';

/**
 * Require a signed-in Scout user with an approved membership in the requested
 * workspace before a route uses the service-role client for workspace data.
 */
export async function requireWorkspaceAccess(workspaceId: string) {
  if (!workspaceId) throw new Error('workspaceId is required.');
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) {
    const error = new Error('Not signed in.') as Error & { status?: number };
    error.status = 401;
    throw error;
  }
  const { data: membership, error: membershipError } = await session
    .from('workspace_members')
    .select('workspace_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .eq('approved', true)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) {
    const error = new Error('You do not have access to this Scout workspace.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
  return user;
}

export function workspaceAccessStatus(error: unknown, fallback = 400) {
  if (error && typeof error === 'object' && 'status' in error) {
    const value = Number((error as { status?: unknown }).status);
    if (value === 401 || value === 403) return value;
  }
  return fallback;
}
