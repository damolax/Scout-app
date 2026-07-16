export const runtime = 'nodejs';

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { featureFlags } from '@/lib/feature-flags';
import { createClient } from '@/lib/supabase-server';
import { encodeOauthState } from '@/lib/oauth-state';

const SEND_ONLY_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.send'];

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const origin = request.nextUrl.origin;
  const workspaceId = request.nextUrl.searchParams.get('workspace_id') || '';
  const requestedReturn = request.nextUrl.searchParams.get('return') || '/settings';
  const returnTo = requestedReturn.startsWith('/') && !requestedReturn.startsWith('//') ? requestedReturn : '/settings';

  if (!featureFlags.gmailSend) return NextResponse.redirect(new URL('/settings?gmail_error=gmail_sending_disabled', origin));
  if (!workspaceId) return NextResponse.redirect(new URL('/settings?gmail_error=missing_workspace', origin));
  if (!clientId || !clientSecret) return NextResponse.redirect(new URL('/settings?gmail_error=google_oauth_env_missing', origin));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login?next=/settings', origin));
  const { data: membership } = await supabase.from('workspace_members').select('workspace_id').eq('workspace_id', workspaceId).eq('user_id', user.id).eq('approved', true).maybeSingle();
  if (!membership) return NextResponse.redirect(new URL('/settings?gmail_error=workspace_access_denied', origin));

  const redirectUri = `${origin}/api/gmail/oauth/callback`;
  const state = encodeOauthState({
    workspace_id: workspaceId,
    user_id: user.id,
    return_to: returnTo,
    created_at: Date.now(),
    nonce: randomUUID(),
    authorization_mode: 'send_only_verification',
  });
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', redirectUri);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', SEND_ONLY_SCOPES.join(' '));
  auth.searchParams.set('access_type', 'offline');
  auth.searchParams.set('prompt', 'consent select_account');
  auth.searchParams.set('include_granted_scopes', 'false');
  auth.searchParams.set('state', state);
  return NextResponse.redirect(auth);
}
