export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!isCronAuthorized(request, body)) return NextResponse.json({ success: false, error: 'Invalid cron secret.' }, { status: 401 });
  return NextResponse.json({ success: true, disabled: true, reason: 'Inbox and reply reading are disabled in the Google send-only verification build.' });
}
