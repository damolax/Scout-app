'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Search, Mail, Settings, Building2, Sparkles } from 'lucide-react';

const items = [
  { href: '/dashboard', label: 'Home', icon: BarChart3 },
  { href: '/scout', label: 'Scout', icon: Search },
  { href: '/prospects', label: 'Prospects', icon: Building2 },
  { href: '/intelligence', label: 'Intelligence', icon: Sparkles },
  { href: '/outreach', label: 'Outreach', icon: Mail },
  { href: '/settings', label: 'Settings', icon: Settings }
];

const groupedRoutes: Record<string, string[]> = {
  '/dashboard': ['/dashboard'],
  '/scout': ['/scout', '/source-scout', '/upload', '/auto-scout', '/email-scout'],
  '/prospects': ['/prospects', '/businesses', '/verify', '/no-inbox', '/data-safety'],
  '/intelligence': ['/intelligence'],
  '/outreach': ['/outreach', '/message', '/templates', '/replies', '/deliverability'],
  '/settings': ['/settings', '/sending-accounts', '/google-verification', '/help', '/challenges']
};

function isActive(pathname: string, href: string) {
  const routes = groupedRoutes[href] || [href];
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function AppNav() {
  const pathname = usePathname();
  return <nav className="nav" aria-label="Main navigation">{items.map((item) => {
    const Icon = item.icon;
    const active = isActive(pathname, item.href);
    return <Link key={item.href} href={item.href} className={active ? 'active' : ''}><Icon size={18} />{item.label}</Link>;
  })}</nav>;
}
