export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';

function formatError(error: unknown) {
  if (!error) return 'Unknown error.';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const value = error as { message?: string; code?: string; details?: string; hint?: string; error?: string; error_description?: string; reason?: string };
    const parts = [value.error_description, value.message || value.error, value.reason, value.code ? `Code: ${value.code}` : '', value.details, value.hint].filter(Boolean);
    return parts.join(' | ') || JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function migrationHint(message: string) {
  const text = message.toLowerCase();
  if (text.includes('column') && (text.includes('refresh_token') || text.includes('access_token') || text.includes('expires_at') || text.includes('raw'))) {
    return `${message} | Supabase schema is missing Gmail token columns. Run the latest supabase/migrations/202607050001_scout_v8_cloud.sql in Supabase SQL Editor, then reconnect Gmail.`;
  }
  if (text.includes('relation') && text.includes('gmail_accounts')) {
    return `${message} | Supabase table gmail_accounts is missing. Run the latest SQL migration, then reconnect Gmail.`;
  }
  if (text.includes('service_role') || text.includes('supabase_service_role_key')) {
    return `${message} | Add SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in Vercel Production env, redeploy, then reconnect Gmail.`;
  }
  return message;
}

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
  if (!response.ok) throw new Error(formatError(json) || `Gmail profile failed with HTTP ${response.status}`);
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
    if (!tokenResponse.ok) throw new Error(formatError(tokenJson) || `Token exchange failed with HTTP ${tokenResponse.status}`);

    const accessToken = String(tokenJson.access_token || '');
    const refreshToken = String(tokenJson.refresh_token || '');
    if (!accessToken) throw new Error('Google did not return an access token. Reconnect Gmail and approve Gmail permissions.');
    if (!refreshToken) throw new Error('Google did not return a refresh token. Click Connect Gmail again. If it still happens, remove Scout App access from your Google Account permissions, then reconnect.');

    const profile = await fetchGmailProfile(accessToken);
    const email = String(profile.emailAddress || '').trim().toLowerCase();
    if (!email) throw new Error('Connected Gmail profile did not return an email address.');

    const supabase = createAdminClient();
    const expiresAt = tokenJson.expires_in ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000).toISOString() : null;
    const payload = {
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
        connected_via: 'native_v820_oauth',
        connected_at: new Date().toISOString(),
        scope: tokenJson.scope || '',
        token_type: tokenJson.token_type || '',
        redirect_uri: redirectUri,
        profile
      }
    };

    const { error: upsertError } = await supabase.from('gmail_accounts').upsert(payload, { onConflict: 'workspace_id,email' });
    if (upsertError) throw new Error(migrationHint(formatError(upsertError)));

    const { data: saved, error: confirmError } = await supabase
      .from('gmail_accounts')
      .select('id,email,status,refresh_token')
      .eq('workspace_id', workspaceId)
      .eq('email', email)
      .maybeSingle();
    if (confirmError) throw new Error(migrationHint(formatError(confirmError)));
    if (!saved?.id || !saved?.refresh_token) throw new Error('Gmail token exchange succeeded, but Scout could not confirm the sender was saved. Run the latest Supabase SQL migration and reconnect Gmail.');

    return redirectWith(origin, returnTo, { gmail_connected: email });
  } catch (err) {
    const msg = migrationHint(formatError(err));
    return redirectWith(origin, returnTo, { gmail_error: msg.slice(0, 420) });
  }
}
