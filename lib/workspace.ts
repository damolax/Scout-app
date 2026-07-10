import { createClient } from './supabase-server';
import { Workspace } from './types';

export async function getCurrentWorkspace(): Promise<{ workspace: Workspace | null; error?: string }> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { workspace: null, error: 'Not signed in' };

  const { data, error } = await supabase
    .from('workspace_members')
    .select('role, approved, workspaces(id, name, api_key, app_url, render_backend_url, default_audience_category_id, default_audience_category_name, dork_settings, extension_settings)')
    .eq('user_id', user.id)
    .eq('approved', true)
    .limit(1)
    .single();

  if (error) return { workspace: null, error: error.message };

  const workspace = Array.isArray(data.workspaces) ? data.workspaces[0] : data.workspaces;
  if (!workspace) return { workspace: null, error: 'No workspace found' };
  return { workspace: workspace as Workspace };
}
