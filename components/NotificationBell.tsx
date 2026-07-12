'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CheckCheck, ExternalLink, RefreshCw, Trash2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message?: string | null;
  business_id?: string | null;
  read_at?: string | null;
  created_at: string;
};

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function formatTime(value: string) {
  try {
    return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return value;
  }
}

function targetFor(row: NotificationRow) {
  if (row.business_id) return `/businesses/${row.business_id}`;
  if (/reply/i.test(row.type)) return '/replies';
  if (/(no_inbox|blocked|bounce)/i.test(row.type)) return '/no-inbox';
  return '/message';
}

export function NotificationBell({ workspaceId }: { workspaceId?: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    try {
      const [items, unreadCount] = await Promise.all([
        supabase
          .from('app_notifications')
          .select('id,type,title,message,business_id,read_at,created_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(12),
        supabase
          .from('app_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .is('read_at', null)
      ]);
      if (items.error) throw items.error;
      if (unreadCount.error) throw unreadCount.error;
      setRows((items.data || []) as NotificationRow[]);
      setUnread(unreadCount.count || 0);
    } catch (err) {
      setRows([]);
      setUnread(0);
      setError(formatError(err).includes('app_notifications') ? 'Run the v8.42 Supabase repair SQL once to enable notifications.' : formatError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  async function markRead(id?: string) {
    if (!workspaceId) return;
    setError('');
    try {
      const response = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, id: id || null, all: !id })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Mark-read failed with HTTP ${response.status}`);
      await load();
    } catch (err) {
      setError(formatError(err).includes('app_notifications') ? 'Run the v8.42 Supabase repair SQL once to enable notifications.' : formatError(err));
    }
  }


  async function deleteNotification(id?: string) {
    if (!workspaceId) return;
    if (!id && !window.confirm('Delete all notifications?')) return;
    setError('');
    try {
      const response = await fetch('/api/notifications/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, id: id || null, all: !id })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Delete failed with HTTP ${response.status}`);
      await load();
    } catch (err) {
      setError(formatError(err));
    }
  }

  return (
    <div className="notification-menu" ref={wrapperRef}>
      <button className="notification-icon" type="button" onClick={() => setOpen((value) => !value)} aria-label="Open notifications">
        <Bell size={18} />
        {unread > 0 ? <strong>{unread > 99 ? '99+' : unread}</strong> : null}
      </button>

      {open ? (
        <div className="notification-popover">
          <div className="notification-popover-head">
            <div>
              <strong>Notifications</strong>
              <p className="muted">Replies, bounces, app updates</p>
            </div>
            <div className="actions compact">
              <button className="icon-btn" type="button" onClick={load} title="Refresh" disabled={loading}><RefreshCw size={15} /></button>
              <button className="icon-btn" type="button" onClick={() => markRead()} title="Mark all read" disabled={!unread}><CheckCheck size={15} /></button>
              <button className="icon-btn" type="button" onClick={() => deleteNotification()} title="Delete all" disabled={!rows.length}><Trash2 size={15} /></button>
              <button className="icon-btn" type="button" onClick={() => setOpen(false)} title="Close"><X size={15} /></button>
            </div>
          </div>

          {error ? <div className="notification-error">Notifications not ready: {error}</div> : null}

          <div className="notification-list">
            {rows.map((row) => (
              <div key={row.id} className={`notification-item ${row.read_at ? '' : 'unread'}`}>
                <div>
                  <strong>{row.title}</strong>
                  <p>{row.message || row.type.replace(/_/g, ' ')}</p>
                  <span>{formatTime(row.created_at)}</span>
                </div>
                <div className="notification-actions">
                  <Link href={targetFor(row)} onClick={() => setOpen(false)} title="Open related page"><ExternalLink size={15} /></Link>
                  {!row.read_at ? <button type="button" onClick={() => markRead(row.id)}>Read</button> : null}
                  <button type="button" onClick={() => deleteNotification(row.id)}>Delete</button>
                </div>
              </div>
            ))}
            {!rows.length && !error ? <div className="notification-empty">No notifications yet.</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
