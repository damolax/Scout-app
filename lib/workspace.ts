import { createClient } from './supabase-server';
import { Workspace } from './types';

type WorkspaceMembershipRow = {
  role?: string | null;
  workspaces?: Workspace | Workspace[] | null;
};

type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
};

function firstWorkspace(value: unknown): Workspace | null {
  if (Array.isArray(value)) return (value[0] || null) as Workspace | null;
  return value && typeof value === 'object' ? (value as Workspace) : null;
}

function compactError(error: unknown) {
  if (error instanceof Error) return error.message;
  const value = error as { message?: string; code?: string; details?: string } | null;
  return [value?.message, value?.code ? `Code ${value.code}` : '', value?.details]
    .filter(Boolean)
    .join(' | ') || String(error || 'Temporary Scout connection error.');
}

function isTransient(error: unknown) {
  const value = error as { message?: string; code?: string } | null;
  const text = `${value?.message || ''} ${value?.code || ''}`.toLowerCase();
  return text.includes('timeout')
    || text.includes('57014')
    || text.includes('fetch failed')
    || text.includes('network')
    || text.includes('connection')
    || text.includes('econnreset')
    || text.includes('temporarily unavailable')
    || text.includes('503');
}

async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const baseDelayMs = Math.max(50, options.baseDelayMs ?? 180);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw lastError;
}

export async function getCurrentWorkspace(): Promise<{ workspace: Workspace | null; error?: string }> {
  try {
    const supabase = await createClient();
    const userResult = await withRetry(async () => {
      const result = await supabase.auth.getUser();
      if (result.error) throw result.error;
      return result;
    });
    const user = userResult.data.user;
    if (!user) return { workspace: null, error: 'Not signed in' };

    try {
      const rpcResult = await withRetry(async () => {
        const result = await supabase.rpc('current_scout_workspace');
        if (result.error) throw result.error;
        return result;
      });
      const rpcWorkspace = firstWorkspace(rpcResult.data);
      if (rpcWorkspace?.id) return { workspace: rpcWorkspace };
    } catch (rpcError) {
      // Continue to the read-only membership fallback. A transient RPC failure
      // must not crash the entire Scout shell.
      const fallbackResult = await withRetry(async () => {
        const result = await supabase
          .from('workspace_members')
          .select('role, workspaces(id, name, api_key, app_url, default_audience_category_id, default_audience_category_name, dork_settings, extension_settings, email_signature_text, email_signature_html, email_logo_url, timezone)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true })
          .limit(10);
        if (result.error) throw result.error;
        return result;
      });

      for (const row of (fallbackResult.data || []) as WorkspaceMembershipRow[]) {
        const workspace = firstWorkspace(row.workspaces);
        if (workspace?.id) return { workspace };
      }

      return {
        workspace: null,
        error: compactError(rpcError) || 'Workspace setup is temporarily unavailable. Try again.'
      };
    }

    return {
      workspace: null,
      error: 'Workspace setup is unavailable for this account. Please sign out and sign in again.'
    };
  } catch (error) {
    return {
      workspace: null,
      error: `Scout could not confirm the workspace after a safe retry. ${compactError(error)}`
    };
  }
}
