export const runtime = 'nodejs';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireWorkspaceAccess } from '@/lib/require-workspace-access';
import { deploymentDailyCap, deploymentRunCap } from '@/lib/sender-health';

const REQUIRED_GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.settings.basic',
];

function normalizeScopes(value: unknown) {
  const source = Array.isArray(value) ? value.map(String) : String(value || '').split(/\s+/);
  return Array.from(new Set(source.map((item) => item.trim()).filter(Boolean)));
}

function decodeState(state: string, secret: string) {
  try {
    const [encoded, suppliedSignature] = state.split('.');
    if (!encoded || !suppliedSignature || !secret) return {};
    const expectedSignature = createHmac('sha256', secret).update(encoded).digest('base64url');
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return {};
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { workspace_id?: string; return_to?: string; created_at?: number };
    if (!parsed.created_at || Math.abs(Date.now() - Number(parsed.created_at)) > 10 * 60 * 1000) return {};
    if (parsed.return_to && (!parsed.return_to.startsWith('/') || parsed.return_to.startsWith('//'))) parsed.return_to = '/settings';
    return parsed;
  } catch {
    return {};
  }
}

function redirectWith(origin: string, path: string, params: Record<string, string>) {
  const url = new URL(path || '/settings', origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return NextResponse.redirect(url);
}

async function fetchGoogleUserInfo(accessToken: string) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(12000),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error_description || json?.error || `Google user profile failed with HTTP ${response.status}`);
  return json as { email?: string; email_verified?: boolean; name?: string; picture?: string; sub?: string };
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const error = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code');
  const stateText = request.nextUrl.searchParams.get('state') || '';
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const state = decodeState(stateText, clientSecret);
  const returnTo = state.return_to || '/settings';
  const workspaceId = state.workspace_id || '';
  const redirectUri = `${origin}/api/gmail/oauth/callback`;

  if (error) return redirectWith(origin, returnTo, { gmail_error: error });
  if (!workspaceId) return redirectWith(origin, '/settings', { gmail_error: 'missing_workspace_state' });
  if (!code) return redirectWith(origin, returnTo, { gmail_error: 'missing_google_code' });
  if (!clientId || !clientSecret) return redirectWith(origin, returnTo, { gmail_error: 'google_oauth_env_missing' });

  try {
    await requireWorkspaceAccess(workspaceId);
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(12000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenJson = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) throw new Error(tokenJson?.error_description || tokenJson?.error || `Token exchange failed with HTTP ${tokenResponse.status}`);

    const accessToken = String(tokenJson.access_token || '');
    if (!accessToken) throw new Error('Google did not return an access token.');
    const googleIdentity = await fetchGoogleUserInfo(accessToken);
    const email = String(googleIdentity.email || '').trim().toLowerCase();
    if (!email || googleIdentity.email_verified === false) throw new Error('Google did not return a verified email address.');

    const supabase = createAdminClient();
    const { data: existing, error: existingError } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('email', email)
      .maybeSingle();
    if (existingError) throw existingError;

    const refreshToken = String(tokenJson.refresh_token || existing?.refresh_token || '');
    if (!refreshToken) throw new Error('Google did not return a refresh token. Remove Scout from Google Account access, then connect again.');

    const now = new Date().toISOString();
    const grantedScopes = normalizeScopes(tokenJson.scope || existing?.granted_scopes || (existing?.raw as any)?.scope || '');
    const oauthReconnectRequired = REQUIRED_GMAIL_SCOPES.some((scope) => !grantedScopes.includes(scope));
    const expiresAt = tokenJson.expires_in ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000).toISOString() : null;
    const deploymentCap = deploymentDailyCap();
    const runCap = deploymentRunCap();
    const payload = {
      workspace_id: workspaceId,
      email,
      display_name: String(googleIdentity.name || existing?.display_name || email),
      status: existing?.pause_kind ? (existing.status || 'paused') : 'connected',
      connection_status: 'verified',
      connection_verified_at: now,
      connection_error: oauthReconnectRequired ? 'Reconnect Gmail and approve sending, Scout-thread reply reading, and Gmail signature settings.' : null,
      granted_scopes: grantedScopes,
      oauth_reconnect_required: oauthReconnectRequired,
      last_reply_sync_status: oauthReconnectRequired ? 'reconnect_required' : (existing?.last_reply_sync_status || 'ready'),
      last_reply_sync_error: oauthReconnectRequired ? 'Required Gmail permissions are missing.' : null,
      access_token: accessToken,
      refresh_token: refreshToken,
      client_id: clientId,
      expires_at: expiresAt,
      paused_until: existing?.pause_kind ? (existing.paused_until || null) : null,
      is_paused: existing?.pause_kind ? Boolean(existing.is_paused) : false,
      paused_reason: existing?.pause_kind ? (existing.paused_reason || null) : null,
      pause_kind: existing?.pause_kind || null,
      safety_override_active: Boolean(existing?.safety_override_active),
      safety_override_until: existing?.safety_override_until || null,
      safety_override_warning: existing?.safety_override_warning || null,
      safety_override_acknowledged_at: existing?.safety_override_acknowledged_at || null,
      pause_issue_key: existing?.pause_issue_key || null,
      pause_issue_count: Number(existing?.pause_issue_count || 0),
      pause_issue_window_started_at: existing?.pause_issue_window_started_at || null,
      pause_issue_window_ends_at: existing?.pause_issue_window_ends_at || null,
      hard_restriction_active: Boolean(existing?.hard_restriction_active),
      hard_restricted_until: existing?.hard_restricted_until || null,
      hard_restriction_reason: existing?.hard_restriction_reason || null,
      last_error: existing?.pause_kind ? (existing.last_error || null) : null,
      deployment_cap: deploymentCap,
      deployment_run_cap: runCap,
      daily_limit: Math.max(1, Math.min(deploymentCap, Number(existing?.daily_limit || deploymentCap))),
      default_run_limit: Math.max(1, Math.min(runCap, Number(existing?.default_run_limit || runCap))),
      health_stage: existing?.health_stage || 'assessment',
      health_cap: existing ? Math.max(0, Math.min(deploymentCap, Number(existing.health_cap ?? 25))) : Math.min(deploymentCap, 25),
      health_reason: existing?.health_reason || 'New sender is in checkpoint-controlled assessment.',
      clean_since: existing?.clean_since || now,
      raw: {
        ...(existing?.raw && typeof existing.raw === 'object' ? existing.raw : {}),
        connected_via: 'native_v10_40_full_oauth',
        authorization_mode: 'send_replies_signature',
        connected_at: now,
        scope: grantedScopes.join(' '),
        required_scopes: REQUIRED_GMAIL_SCOPES,
        token_type: tokenJson.token_type || '',
        redirect_uri: redirectUri,
        google_identity: googleIdentity,
      },
    };
    const { error: upsertError } = await supabase.from('gmail_accounts').upsert(payload, { onConflict: 'workspace_id,email' });
    if (upsertError) throw upsertError;

    return redirectWith(origin, returnTo, { gmail_connected: email });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return redirectWith(origin, returnTo, { gmail_error: msg.slice(0, 240) });
  }
}
