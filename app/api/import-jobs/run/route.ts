export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '@/lib/require-workspace-access';
import { processImportJobs } from '@/lib/import-worker';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId || '').trim();
    const jobId = String(body.jobId || '').trim();
    await requireWorkspaceAccess(workspaceId);
    const result = await processImportJobs({ workspaceId, jobId: jobId || null, maxSeconds: 42, batchSize: Number(body.batchSize || 250), jobLimit: 1 });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
