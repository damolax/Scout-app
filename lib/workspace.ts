import { createClient } from './supabase-server';
import { Workspace } from './types';

type WorkspaceMembershipRow = {
  role?: string | null;
  approved?: boolean | null;
  workspaces?: Workspace | Workspace[] | null;
};

export async function getCurrentWorkspace(): Promise<{ workspace: Workspace | null; error?: string }> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { workspace: null, error: 'Not signed in' };

  // Keep the original v10.30 architecture: only read an existing approved
  // membership. Do not create or repair workspaces during normal page loads.
  // An array query avoids PostgREST's "Cannot coerce ... to a single JSON
  // object" error when historical duplicate membership rows exist.
  const { data, error } = await supabase
    .from('workspace_members')
    .select('role, approved, workspaces(id, name, api_key, app_url, render_backend_url, default_audience_category_id, default_audience_category_name, dork_settings, extension_settings, email_signature_text, email_signature_html, email_logo_url)')
    .eq('user_id', user.id)
    .eq('approved', true)
    .order('role', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) return { workspace: null, error: error.message };

  const row = ((data || []) as WorkspaceMembershipRow[])[0];
  const workspace = Array.isArray(row?.workspaces) ? row?.workspaces[0] : row?.workspaces;
  if (!workspace) return { workspace: null, error: 'No approved workspace found for this account.' };
  return { workspace: workspace as Workspace };
}
