export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';

function decodeState(state: string) {
  try {
    const json = Buffer.from(state, 'base64url').toString('utf8');
    return JSON.parse(json) as { workspace_id?: string; return_to?: string; created_at?: number };
  } catch {
    return {};
  }
}

function redirectWith(origin: string, path: string, params: Record<string, string>) {
  const url = new URL(path || '/settings', origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return NextResponse.redirect(url);
}

async function fetchGmailProfile(accessToken: string) {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || json?.error || `Gmail profile failed with HTTP ${response.status}`);
  return json as { emailAddress?: string; messagesTotal?: number; threadsTotal?: number };
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const error = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code');
  const stateText = request.nextUrl.searchParams.get('state') || '';
  const state = decodeState(stateText);
  const returnTo = state.return_to || '/settings';
  const workspaceId = state.workspace_id || '';
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = `${origin}/api/gmail/oauth/callback`;

  if (error) return redirectWith(origin, returnTo, { gmail_error: error });
  if (!workspaceId) return redirectWith(origin, '/settings', { gmail_error: 'missing_workspace_state' });
  if (!code) return redirectWith(origin, returnTo, { gmail_error: 'missing_google_code' });
  if (!clientId || !clientSecret) return redirectWith(origin, returnTo, { gmail_error: 'google_oauth_env_missing' });

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokenJson = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) throw new Error(tokenJson?.error_description || tokenJson?.error || `Token exchange failed with HTTP ${tokenResponse.status}`);

    const accessToken = String(tokenJson.access_token || '');
    const refreshToken = String(tokenJson.refresh_token || '');
    if (!accessToken) throw new Error('Google did not return an access token.');
    if (!refreshToken) throw new Error('Google did not return a refresh token. Reconnect and approve offline access, or remove the old app grant from your Google Account first.');

    const profile = await fetchGmailProfile(accessToken);
    const email = String(profile.emailAddress || '').trim().toLowerCase();
    if (!email) throw new Error('Connected Gmail profile did not return an email address.');

    const supabase = createAdminClient();
    const expiresAt = tokenJson.expires_in ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000).toISOString() : null;
    const { error: upsertError } = await supabase.from('gmail_accounts').upsert({
      workspace_id: workspaceId,
      email,
      display_name: email,
      status: 'connected',
      access_token: accessToken,
      refresh_token: refreshToken,
      client_id: clientId,
      expires_at: expiresAt,
      paused_until: null,
      last_error: null,
      raw: {
        connected_via: 'native_v819_oauth',
        connected_at: new Date().toISOString(),
        scope: tokenJson.scope || '',
        token_type: tokenJson.token_type || '',
        redirect_uri: redirectUri,
        profile
      }
    }, { onConflict: 'workspace_id,email' });
    if (upsertError) throw upsertError;

    return redirectWith(origin, returnTo, { gmail_connected: email });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return redirectWith(origin, returnTo, { gmail_error: msg.slice(0, 240) });
  }
}
