import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { checkScoutSchema } from '@/lib/schema-readiness';
import { getCurrentWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) {
    return NextResponse.json({ success: false, ready: false, error: error || 'Not signed in.' }, { status: 401 });
  }

  try {
    const result = await checkScoutSchema(createAdminClient(), workspace.id);
    return NextResponse.json({ success: true, ...result }, { status: result.ready ? 200 : 503 });
  } catch (schemaError) {
    return NextResponse.json({
      success: false,
      ready: false,
      error: schemaError instanceof Error ? schemaError.message : String(schemaError)
    }, { status: 500 });
  }
}
