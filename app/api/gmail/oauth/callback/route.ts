export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';
import { decodeAndVerifyOauthState } from '@/lib/oauth-state';

function redirectWith(origin: string, path: string, params: Record<string, string>) {
  const url = new URL(path || '/settings', origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return NextResponse.redirect(url);
}

async function fetchGoogleUserInfo(accessToken: string) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error_description || json?.error || `Google user profile failed with HTTP ${response.status}`);
  return json as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const error = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code');
  const stateText = request.nextUrl.searchParams.get('state') || '';
  const state = decodeAndVerifyOauthState(stateText);
  const returnTo = state?.return_to || '/settings';
  const workspaceId = state?.workspace_id || '';
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = `${origin}/api/gmail/oauth/callback`;

  if (error) return redirectWith(origin, returnTo, { gmail_error: error });
  if (!state || !workspaceId) return redirectWith(origin, '/settings', { gmail_error: 'invalid_or_expired_oauth_state' });
  if (!code) return redirectWith(origin, returnTo, { gmail_error: 'missing_google_code' });
  if (!clientId || !clientSecret) return redirectWith(origin, returnTo, { gmail_error: 'google_oauth_env_missing' });

  try {
    const sessionClient = await createClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user || user.id !== state.user_id) throw new Error('Your Scout session changed. Sign in and connect Gmail again.');
    const { data: membership } = await sessionClient.from('workspace_members').select('workspace_id').eq('workspace_id', workspaceId).eq('user_id', user.id).eq('approved', true).maybeSingle();
    if (!membership) throw new Error('You no longer have access to this Scout workspace.');

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
    if (!accessToken) throw new Error('Google did not return an access token.');

    // gmail.send does not authorize Gmail users.getProfile. The OpenID email
    // scope does authorize this minimal identity endpoint, so the first-stage
    // verification build can identify the connected sender without requesting
    // an inbox-reading scope.
    const profile = await fetchGoogleUserInfo(accessToken);
    const email = String(profile.email || '').trim().toLowerCase();
    if (!email || profile.email_verified === false) throw new Error('Google did not return a verified email address for this connection.');

    const supabase = createAdminClient();
    const { data: existing } = await supabase
      .from('gmail_accounts')
      .select('refresh_token,raw,display_name')
      .eq('workspace_id', workspaceId)
      .eq('email', email)
      .maybeSingle();
    const refreshToken = String(tokenJson.refresh_token || existing?.refresh_token || '');
    if (!refreshToken) throw new Error('Google did not return a refresh token. Remove Scout from your Google Account permissions, then connect Gmail again.');

    const expiresAt = tokenJson.expires_in ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000).toISOString() : null;
    const previousRaw = existing?.raw && typeof existing.raw === 'object' && !Array.isArray(existing.raw) ? existing.raw : {};
    const { error: upsertError } = await supabase.from('gmail_accounts').upsert({
      workspace_id: workspaceId,
      email,
      display_name: String(profile.name || existing?.display_name || email),
      status: 'connected',
      access_token: accessToken,
      refresh_token: refreshToken,
      client_id: clientId,
      expires_at: expiresAt,
      paused_until: null,
      last_error: null,
      raw: {
        ...previousRaw,
        connected_via: 'native_v1035_send_only_oauth',
        authorization_mode: 'send_only_verification',
        connected_at: new Date().toISOString(),
        scope: tokenJson.scope || '',
        token_type: tokenJson.token_type || '',
        redirect_uri: redirectUri,
        google_identity: profile
      }
    }, { onConflict: 'workspace_id,email' });
    if (upsertError) throw upsertError;

    return redirectWith(origin, returnTo, { gmail_connected: email });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return redirectWith(origin, returnTo, { gmail_error: msg.slice(0, 240) });
  }
}
