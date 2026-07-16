export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID/NEXT_PUBLIC_GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in Vercel.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error_description || json?.error || `Token refresh failed with HTTP ${response.status}`);
  return { access_token: String(json.access_token || ''), expires_in: Number(json.expires_in || 3600) };
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json();
    const workspaceId = String(input.workspace_id || '');
    const accountId = String(input.gmail_account_id || '');
    if (!workspaceId || !accountId) throw new Error('workspace_id and gmail_account_id are required.');

    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Not signed in.' }, { status: 401 });
    const { data: membership } = await session.from('workspace_members').select('workspace_id').eq('workspace_id', workspaceId).eq('user_id', user.id).eq('approved', true).maybeSingle();
    if (!membership) return NextResponse.json({ success: false, error: 'You do not have access to this Scout workspace.' }, { status: 403 });

    const supabase = createAdminClient();
    const { data: account, error: accountError } = await supabase.from('gmail_accounts').select('*').eq('workspace_id', workspaceId).eq('id', accountId).single();
    if (accountError || !account) throw new Error(accountError?.message || 'Gmail sender account not found.');
    let accessToken = String(account.access_token || '');
    const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
    if (!accessToken || expiresAt < Date.now() + 60_000) {
      if (!account.refresh_token) throw new Error('No refresh token stored. Reconnect Gmail in Settings.');
      const refreshed = await refreshAccessToken(String(account.refresh_token));
      accessToken = refreshed.access_token;
      await supabase.from('gmail_accounts').update({ access_token: accessToken, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), last_error: null }).eq('workspace_id', workspaceId).eq('id', accountId);
    }

    // The send-only verification flow requests OpenID email identity. It does
    // not request Gmail inbox metadata, so verify the sender through userinfo.
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
    const profile = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(profile?.error_description || profile?.error || `Google identity check failed with HTTP ${response.status}`);
    const email = String(profile.email || '').trim().toLowerCase();
    if (!email || profile.email_verified === false) throw new Error('Google did not return a verified email address. Reconnect Gmail.');
    if (email !== String(account.email || '').trim().toLowerCase()) throw new Error(`This token belongs to ${email}, not ${account.email}. Remove the sender and reconnect the correct Gmail account.`);

    await supabase.from('gmail_accounts').update({
      display_name: String(profile.name || account.display_name || email),
      status: 'connected',
      access_token: accessToken,
      last_error: null,
      raw: { ...(account.raw || {}), last_profile_check: new Date().toISOString(), google_identity: profile },
      updated_at: new Date().toISOString(),
    }).eq('workspace_id', workspaceId).eq('id', accountId);
    return NextResponse.json({ success: true, email, profile: { email, name: profile.name || null, email_verified: profile.email_verified !== false } });
  } catch (err) {
    return NextResponse.json({ success: false, error: formatError(err) }, { status: 400 });
  }
}
