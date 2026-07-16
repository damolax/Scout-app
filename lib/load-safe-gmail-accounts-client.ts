import type { GmailAccount } from '@/lib/types';

export async function loadAllSafeGmailAccounts(workspaceId: string): Promise<GmailAccount[]> {
  const rows: GmailAccount[] = [];
  const pageSize = 100;
  for (let page = 1; page <= 10; page += 1) {
    const params = new URLSearchParams({ workspaceId, page: String(page), pageSize: String(pageSize), filter: 'all' });
    const response = await fetch(`/api/gmail/accounts?${params.toString()}`, { cache: 'no-store' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.success === false) throw new Error(json?.error || 'Could not load Gmail senders.');
    const batch = (Array.isArray(json.accounts) ? json.accounts : []) as GmailAccount[];
    rows.push(...batch);
    const totalPages = Math.max(1, Number(json?.pagination?.totalPages || 1));
    if (page >= totalPages || batch.length < pageSize) break;
  }
  return rows;
}
