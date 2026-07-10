'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Bell } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

export function NotificationBell({ workspaceId }: { workspaceId?: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [unread, setUnread] = useState(0);

  async function load() {
    if (!workspaceId) return;
    const { count } = await supabase
      .from('app_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .is('read_at', null);
    setUnread(count || 0);
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return (
    <Link href="/notifications" className="notification-pill" title="Notifications">
      <Bell size={17} />
      <span>Notifications</span>
      {unread > 0 ? <strong>{unread > 99 ? '99+' : unread}</strong> : null}
    </Link>
  );
}
