'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, UploadCloud, Building2, Mail, Settings, Rocket, Inbox } from 'lucide-react';

const items = [
  { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { href: '/source-scout', label: 'Scout & Import', icon: UploadCloud },
  { href: '/businesses', label: 'Leads', icon: Building2 },
  { href: '/message', label: 'Outreach', icon: Mail },
  { href: '/replies', label: 'Inbox', icon: Inbox },
  { href: '/operations', label: 'Automation', icon: Rocket },
  { href: '/settings', label: 'Settings', icon: Settings }
];

const groupedRoutes: Record<string, string[]> = {
  '/source-scout': ['/source-scout', '/upload', '/daily-scouting', '/auto-scout', '/email-scout', '/verify'],
  '/businesses': ['/businesses', '/data-safety'],
  '/message': ['/message', '/templates', '/deliverability'],
  '/replies': ['/replies', '/no-inbox', '/notifications'],
  '/operations': ['/operations']
};

function isActive(pathname: string, href: string) {
  const routes = groupedRoutes[href] || [href];
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Main navigation">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
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
