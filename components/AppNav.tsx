'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Upload, Building2, ShieldCheck, Search, Mail, MessageSquareReply, Ban, Settings, Database, LayoutDashboard } from 'lucide-react';

const items = [
  { href: '/main-scout', label: 'Main Scout App', icon: LayoutDashboard },
  { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { href: '/upload', label: 'Upload Lists', icon: Upload },
  { href: '/businesses', label: 'Businesses', icon: Building2 },
  { href: '/verify', label: 'Verify Emails', icon: ShieldCheck },
  { href: '/auto-scout', label: 'Auto Scout', icon: Search },
  { href: '/email-scout', label: 'Email Scout', icon: Mail },
  { href: '/replies', label: 'Replies', icon: MessageSquareReply },
  { href: '/no-inbox', label: 'No Inbox', icon: Ban },
  { href: '/data-safety', label: 'Data Safety', icon: Database },
  { href: '/settings', label: 'Settings', icon: Settings }
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} className={active ? 'active' : ''}>
            <Icon size={18} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
