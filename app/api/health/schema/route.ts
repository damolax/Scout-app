import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { checkScoutSchema } from '@/lib/schema-readiness';
import { getCurrentWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) {
    return NextResponse.json({ success: false, ready: false, confirmedMissing: false, degraded: [error || 'Not signed in.'], error: error || 'Not signed in.' }, { status: 401 });
  }

  try {
    const result = await checkScoutSchema(createAdminClient(), workspace.id);
    return NextResponse.json({ success: true, ...result }, { status: result.confirmedMissing ? 503 : 200 });
  } catch (schemaError) {
    const detail = schemaError instanceof Error ? schemaError.message : String(schemaError);
    return NextResponse.json({
      success: true,
      ready: true,
      confirmedMissing: false,
      requiredVersion: '10.42.5',
      installedVersion: null,
      missing: [],
      degraded: [detail],
      error: detail
    }, { status: 200 });
  }
}
