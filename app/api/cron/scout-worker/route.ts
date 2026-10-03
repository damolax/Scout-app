export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { runUnifiedScoutWorker } from '@/lib/unified-scout-worker';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!isCronAuthorized(request, body)) {
    return NextResponse.json({ success: false, error: 'Invalid cron secret.' }, { status: 401 });
  }
  try {
    const results = await runUnifiedScoutWorker(Number(body.limit || 1));
    return NextResponse.json({ success: true, processed: results.length, results });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
