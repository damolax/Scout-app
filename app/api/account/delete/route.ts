export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { featureFlags } from '@/lib/feature-flags';

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest) {
  if (!featureFlags.accountDeletion) return NextResponse.json({ success: false, error: 'Account deletion is temporarily unavailable.' }, { status: 503 });
  try {
    const input = await request.json().catch(() => ({}));
    if (String(input.confirmation || '') !== 'DELETE') return NextResponse.json({ success: false, error: 'Type DELETE exactly to confirm permanent deletion.' }, { status: 400 });

    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ success: false, error: userError?.message || 'Not signed in.' }, { status: 401 });

    const lastSignIn = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
    if (!lastSignIn || Date.now() - lastSignIn > 15 * 60 * 1000) {
      return NextResponse.json({ success: false, reauthenticate: true, error: 'Sign out and sign back in, then repeat deletion within 15 minutes.' }, { status: 401 });
    }

    const { data: memberships, error: membershipError } = await supabase.from('workspace_members').select('workspace_id,role').eq('user_id', user.id);
    if (membershipError) throw membershipError;
    if (!memberships?.length) throw new Error('No Scout workspace was found for this account.');

    const admin = createAdminClient();
    const deletedAt = new Date().toISOString();
    const deletedWorkspaceIds: string[] = [];
    for (const membership of memberships) {
      const workspaceId = String(membership.workspace_id || '');
      if (!workspaceId) continue;
      const { count, error: countError } = await admin.from('workspace_members').select('user_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
      if (countError) throw countError;
      const soleOwner = String(membership.role || '').toLowerCase() === 'owner' && Number(count || 0) <= 1;
      if (soleOwner) {
        const { error: workspaceError } = await admin.from('workspaces').delete().eq('id', workspaceId);
        if (workspaceError) throw workspaceError;
        deletedWorkspaceIds.push(workspaceId);
      } else {
        const { error: memberDeleteError } = await admin.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', user.id);
        if (memberDeleteError) throw memberDeleteError;
      }
    }

    const workspaceFilter = deletedWorkspaceIds.map((id) => `first_workspace_id.eq.${id}`);
    const { error: fingerprintError } = await admin.from('team_scouted_leads').update({
      first_workspace_id: null, first_business_id: null, first_user_id: null,
      email: null, website: null, domain: null, name: null, source: null,
      raw: { retained_for_duplicate_prevention: true, owner_deleted_at: deletedAt }, last_seen_at: deletedAt,
    }).or([...workspaceFilter, `first_user_id.eq.${user.id}`].join(','));
    if (fingerprintError && !String(fingerprintError.message || '').includes('team_scouted_leads')) throw fingerprintError;
    await admin.from('profiles').delete().eq('id', user.id);
    const { error: authError } = await admin.auth.admin.deleteUser(user.id);
    if (authError) throw authError;

    return NextResponse.json({ success: true, deleted_at: deletedAt });
  } catch (error) {
    return NextResponse.json({ success: false, error: message(error) }, { status: 500 });
  }
}
