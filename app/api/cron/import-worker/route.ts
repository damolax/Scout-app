export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { processImportJobs } from '@/lib/import-worker';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!isCronAuthorized(request, body)) return NextResponse.json({ success: false, error: 'Invalid cron secret.' }, { status: 401 });
  try {
    const result = await processImportJobs({ maxSeconds: 48, batchSize: Number(body.batchSize || 250), jobLimit: Number(body.jobLimit || 3) });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
