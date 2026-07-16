export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { featureFlags } from '@/lib/feature-flags';
import { isScoutAdminEmail } from '@/lib/admin';

const ADMIN_WORKSPACE_ID = process.env.SCOUT_DEFAULT_WORKSPACE_ID || '00000000-0000-4000-8000-000000000001';

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest) {
  if (!featureFlags.accountDeletion) {
    return NextResponse.json({ success: false, error: 'Account deletion is temporarily unavailable.' }, { status: 503 });
  }
  try {
    const input = await request.json().catch(() => ({}));
    if (String(input.confirmation || '') !== 'DELETE') {
      return NextResponse.json({ success: false, error: 'Type DELETE exactly to confirm permanent deletion.' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ success: false, error: userError?.message || 'Not signed in.' }, { status: 401 });
    if (isScoutAdminEmail(user.email)) {
      return NextResponse.json({ success: false, error: 'The main Scout administrator account cannot be deleted from this screen.' }, { status: 403 });
    }

    const lastSignIn = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
    if (!lastSignIn || Date.now() - lastSignIn > 15 * 60 * 1000) {
      return NextResponse.json({ success: false, reauthenticate: true, error: 'For security, sign out and sign back in, then repeat deletion within 15 minutes.' }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id,workspaces(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membershipError) throw membershipError;
    const workspaceId = String(membership?.workspace_id || '');
    if (!workspaceId) throw new Error('No Scout workspace was found for this account.');

    const admin = createAdminClient();
    const { data: profile } = await admin.from('profiles').select('full_name,email').eq('id', user.id).maybeSingle();
    const deletedAt = new Date().toISOString();
    const deletedEmail = String(profile?.email || user.email || 'unknown');
    const deletedName = String(profile?.full_name || 'Scout user');

    // Keep the prospect key blocked, but remove the deleted owner's identity.
    const { error: fingerprintError } = await admin.from('team_scouted_leads').update({
      first_workspace_id: null,
      first_business_id: null,
      first_user_id: null,
      email: null,
      website: null,
      domain: null,
      name: null,
      source: null,
      raw: { retained_for_duplicate_prevention: true, owner_deleted_at: deletedAt },
      last_seen_at: deletedAt,
    }).or(`first_workspace_id.eq.${workspaceId},first_user_id.eq.${user.id}`);
    if (fingerprintError && !String(fingerprintError.message || '').includes('team_scouted_leads')) throw fingerprintError;

    await admin.from('app_notifications').insert({
      workspace_id: ADMIN_WORKSPACE_ID,
      type: 'account_deleted',
      title: 'Scout account deleted',
      message: `${deletedName} (${deletedEmail}) permanently deleted their Scout account at ${deletedAt}.`,
      entity_type: 'deleted_auth_user',
      entity_id: user.id,
      raw: { deleted_name: deletedName, deleted_email: deletedEmail, deleted_at: deletedAt, former_workspace_id: workspaceId },
    });

    const { error: workspaceError } = await admin.from('workspaces').delete().eq('id', workspaceId);
    if (workspaceError) throw workspaceError;
    await admin.from('profiles').delete().eq('id', user.id);

    const { error: authError } = await admin.auth.admin.deleteUser(user.id);
    if (authError) throw authError;

    return NextResponse.json({ success: true, deleted_at: deletedAt });
  } catch (error) {
    return NextResponse.json({ success: false, error: message(error) }, { status: 500 });
  }
}
