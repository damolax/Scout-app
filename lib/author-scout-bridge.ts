type WorkspaceIdentity = { id: string; name?: string | null };

function apiBase() {
  const value = String(process.env.AUTHOR_SCOUT_API_BASE || '').trim().replace(/\/+$/, '');
  if (!value) throw new Error('AUTHOR_SCOUT_API_BASE is not configured.');
  return value;
}

function sharedSecret() {
  const value = String(process.env.SCOUT_PLATFORM_SHARED_SECRET || '').trim();
  if (value.length < 24) throw new Error('SCOUT_PLATFORM_SHARED_SECRET is not configured.');
  return value;
}

async function jsonRequest(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(apiBase() + path, { ...init, signal: controller.signal, cache: 'no-store' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json?.detail || json?.error || ('Author Scout request failed with HTTP ' + response.status));
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export async function getAuthorScoutSession(workspace: WorkspaceIdentity) {
  const json = await jsonRequest('/api/v1/platform/session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-scout-platform-secret': sharedSecret(),
    },
    body: JSON.stringify({ workspace_id: workspace.id, workspace_name: workspace.name || 'Scout Workspace' }),
  });
  if (!json?.session) throw new Error('Author Scout did not return a service session.');
  return String(json.session);
}

export async function authorScoutRequest(workspace: WorkspaceIdentity, path: string, init: RequestInit = {}) {
  const session = await getAuthorScoutSession(workspace);
  const headers = new Headers(init.headers || {});
  headers.set('x-author-scout-key', session);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return jsonRequest(path, { ...init, headers });
}
