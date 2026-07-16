export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  return NextResponse.json({
    success: Boolean(clientId && clientSecret),
    client_id_configured: Boolean(clientId),
    client_secret_configured: Boolean(clientSecret),
    redirect_path: '/api/gmail/oauth/callback',
    required_scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.send'],
    authorization_mode: 'send_only_verification'
  });
}
