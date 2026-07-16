'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

export type TeamAccountRow = {
  user_id: string;
  full_name: string | null;
  user_email: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  lifetime_sent: number | null;
  connected_senders: number | null;
  total_leads: number | null;
  ready_leads: number | null;
  real_replies: number | null;
  auto_replies: number | null;
  no_inbox_count: number | null;
  created_at: string | null;
  matching_count: number | null;
};

export type TeamSummary = {
  registered_users: number | null;
  connected_accounts: number | null;
  lifetime_sent: number | null;
  real_replies: number | null;
  total_leads: number | null;
};

function n(value: unknown) {
  return Number(value || 0).toLocaleString();
}

const PAGE_SIZE = 20;

export default function TeamClient({ initialAccounts, initialMatchingCount }: { initialAccounts: TeamAccountRow[]; initialMatchingCount: number }) {
  const supabaseRef = useRef(createClient());
  const firstLoad = useRef(true);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(initialAccounts);
  const [matchingCount, setMatchingCount] = useState(initialMatchingCount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      const { data, error: rpcError } = await supabaseRef.current.rpc('admin_team_dashboard_page', {
        p_search: query.trim(),
        p_sort: sort,
        p_page: page,
        p_page_size: PAGE_SIZE,
      });
      if (rpcError) {
        setError(rpcError.message);
      } else {
        const nextRows = (data || []) as TeamAccountRow[];
        setRows(nextRows);
        setMatchingCount(Number(nextRows[0]?.matching_count || 0));
      }
      setLoading(false);
    }, query ? 300 : 50);
    return () => window.clearTimeout(timer);
  }, [query, sort, page]);

  function changeQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  function changeSort(value: 'newest' | 'oldest') {
    setSort(value);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(matchingCount / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visiblePages = Array.from({ length: pageCount }, (_, index) => index + 1)
    .filter((value) => value === 1 || value === pageCount || Math.abs(value - currentPage) <= 2);
  const start = rows.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const end = rows.length ? Math.min((currentPage - 1) * PAGE_SIZE + rows.length, matchingCount) : 0;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="topbar">
        <div><h3>User lifetime totals</h3><p className="muted">Twenty users per page. Connected accounts are shown only as a count.</p></div>
        <div className="actions">
          <input className="input" style={{ minWidth: 260 }} value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Search name or email" />
          <select className="select" value={sort} onChange={(event) => changeSort(event.target.value as 'newest' | 'oldest')}>
            <option value="newest">Newest registered</option>
            <option value="oldest">Oldest registered</option>
          </select>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 10 }}>{loading ? 'Loading users…' : `Showing ${start}–${end} of ${matchingCount.toLocaleString()} matching users.`}</p>
      {error ? <div className="error" style={{ marginBottom: 10 }}>Could not load users: {error}</div> : null}
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Registered</th><th>Connected Accounts</th><th>Lifetime Sent</th><th>Total Leads</th><th>Ready Leads</th><th>Real Replies</th><th>Auto Replies</th><th>No Inbox</th></tr></thead><tbody>
        {rows.map((row) => (
          <tr key={row.user_id}>
            <td>{row.full_name || '-'}</td>
            <td>{row.user_email || '-'}</td>
            <td>{row.created_at ? new Date(row.created_at).toLocaleDateString() : '-'}</td>
            <td>{n(row.connected_senders)}</td>
            <td>{n(row.lifetime_sent)}</td>
            <td>{n(row.total_leads)}</td>
            <td>{n(row.ready_leads)}</td>
            <td>{n(row.real_replies)}</td>
            <td>{n(row.auto_replies)}</td>
            <td>{n(row.no_inbox_count)}</td>
          </tr>
        ))}
        {!rows.length && !loading ? <tr><td colSpan={10} className="muted">No users match this search.</td></tr> : null}
      </tbody></table></div>

      {pageCount > 1 ? <div className="actions" style={{ marginTop: 14 }}>
        <button className="btn secondary" type="button" disabled={currentPage <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
        {visiblePages.map((value, index) => {
          const previous = visiblePages[index - 1];
          return <span key={value} style={{ display: 'contents' }}>{previous && value - previous > 1 ? <span className="muted">…</span> : null}<button className={value === currentPage ? 'btn' : 'btn secondary'} disabled={loading} type="button" onClick={() => setPage(value)}>{value}</button></span>;
        })}
        <button className="btn secondary" type="button" disabled={currentPage >= pageCount || loading} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button>
      </div> : null}
    </div>
  );
}
