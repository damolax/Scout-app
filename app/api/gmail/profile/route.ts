export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '@/lib/require-workspace-access';
import { createAdminClient } from '@/lib/supabase-admin';

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('Google OAuth environment variables are missing.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(12000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error_description || json?.error || `Token refresh failed with HTTP ${response.status}`);
  return { access_token: String(json.access_token || ''), expires_in: Number(json.expires_in || 3600) };
}

export async function POST(request: NextRequest) {
  let workspaceId = '';
  let accountId = '';
  const supabase = createAdminClient();
  try {
    const input = await request.json();
    workspaceId = String(input.workspace_id || '');
    accountId = String(input.gmail_account_id || '');
    if (!workspaceId || !accountId) throw new Error('workspace_id and gmail_account_id are required.');
    await requireWorkspaceAccess(workspaceId);
    const { data: account, error: accountError } = await supabase.from('gmail_accounts').select('*').eq('workspace_id', workspaceId).eq('id', accountId).single();
    if (accountError || !account) throw new Error(accountError?.message || 'Gmail sender account not found.');
    let accessToken = String(account.access_token || '');
    const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
    if (!accessToken || expiresAt < Date.now() + 60_000) {
      if (!account.refresh_token) throw new Error('No refresh token stored. Reconnect Gmail.');
      const refreshed = await refreshAccessToken(String(account.refresh_token));
      accessToken = refreshed.access_token;
      await supabase.from('gmail_accounts').update({ access_token: accessToken, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString() }).eq('workspace_id', workspaceId).eq('id', accountId);
    }
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(12000),
    });
    const profile = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(profile?.error_description || profile?.error || `Google identity check failed with HTTP ${response.status}`);
    const email = String(profile.email || account.email || '').toLowerCase();
    const checkedAt = new Date().toISOString();
    await supabase.from('gmail_accounts').update({
      email,
      display_name: String(profile.name || account.display_name || email),
      connection_status: 'verified',
      connection_verified_at: checkedAt,
      connection_error: null,
      access_token: accessToken,
      last_error: null,
      raw: { ...(account.raw || {}), last_profile_check: checkedAt, google_identity: profile },
    }).eq('workspace_id', workspaceId).eq('id', accountId);
    return NextResponse.json({ success: true, email, profile });
  } catch (err) {
    const error = formatError(err);
    if (workspaceId && accountId) {
      await supabase.from('gmail_accounts').update({ connection_status: 'error', connection_error: error, last_error: error }).eq('workspace_id', workspaceId).eq('id', accountId);
    }
    return NextResponse.json({ success: false, error }, { status: 400 });
  }
}
