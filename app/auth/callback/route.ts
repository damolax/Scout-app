import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') || '/dashboard';

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  const redirectUrl = new URL(request.url);
  redirectUrl.pathname = next.startsWith('/') ? next : '/dashboard';
  redirectUrl.search = '';
  return NextResponse.redirect(redirectUrl);
}
