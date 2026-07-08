export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';

function formatError(error: unknown) {
  if (!error) return 'Unknown error.';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const value = error as { message?: string; code?: string; details?: string; hint?: string; error?: string; reason?: string };
    return [value.message || value.error, value.reason, value.code ? `Code: ${value.code}` : '', value.details, value.hint].filter(Boolean).join(' | ') || JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const problems: string[] = [];

  if (!clientId) problems.push('Missing GOOGLE_CLIENT_ID or NEXT_PUBLIC_GOOGLE_CLIENT_ID in Vercel.');
  if (!clientSecret) problems.push('Missing GOOGLE_CLIENT_SECRET in Vercel.');
  if (!supabaseUrl) problems.push('Missing NEXT_PUBLIC_SUPABASE_URL in Vercel.');
  if (!serviceRole) problems.push('Missing SUPABASE_SERVICE_ROLE_KEY in Vercel. Gmail OAuth callback needs it to save the sender.');

  let schemaReady = false;
  let schemaMessage = 'Not checked.';
  if (supabaseUrl && serviceRole) {
    try {
      const supabase = createAdminClient();
      const { error } = await supabase.from('gmail_accounts').select('id,email,access_token,refresh_token,expires_at,raw').limit(1);
      if (error) throw error;
      schemaReady = true;
      schemaMessage = 'gmail_accounts token columns are ready.';
    } catch (err) {
      schemaMessage = formatError(err);
      problems.push(`Supabase Gmail table/schema issue: ${schemaMessage}. Run the latest SQL migration.`);
    }
  }

  return NextResponse.json({
    success: problems.length === 0,
    client_id_configured: Boolean(clientId),
    client_secret_configured: Boolean(clientSecret),
    supabase_url_configured: Boolean(supabaseUrl),
    service_role_configured: Boolean(serviceRole),
    schema_ready: schemaReady,
    schema_message: schemaMessage,
    problems,
    redirect_path: '/api/gmail/oauth/callback',
    required_redirect_uri_note: 'Use the live app origin plus /api/gmail/oauth/callback, for example https://scout-app-oyeola.vercel.app/api/gmail/oauth/callback',
    required_scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly'
    ]
  });
}
