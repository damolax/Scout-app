import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json().catch(() => ({}));
    const workspaceId = String(input.workspace_id || input.workspaceId || '').trim();
    const timezone = String(input.timezone || '').trim();
    if (!workspaceId) return NextResponse.json({ success: false, error: 'workspace_id is required.' }, { status: 400 });
    if (!validTimezone(timezone)) return NextResponse.json({ success: false, error: 'Choose a valid IANA timezone, for example Africa/Lagos.' }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Not signed in.' }, { status: 401 });
    const { data: member, error: memberError } = await supabase.from('workspace_members').select('workspace_id').eq('workspace_id', workspaceId).eq('user_id', user.id).limit(1);
    if (memberError) throw memberError;
    if (!member?.length) return NextResponse.json({ success: false, error: 'You do not belong to this workspace.' }, { status: 403 });

    const admin = createAdminClient();
    const { error } = await admin.from('workspaces').update({ timezone, updated_at: new Date().toISOString() }).eq('id', workspaceId);
    if (error) throw error;
    return NextResponse.json({ success: true, timezone });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
