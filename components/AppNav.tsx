'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Search, Mail, Inbox, Settings, HelpCircle, Building2, FileText } from 'lucide-react';

const items = [
  { href: '/dashboard', label: 'Home', icon: BarChart3 },
  { href: '/source-scout', label: 'Find Leads', icon: Search },
  { href: '/businesses', label: 'Leads', icon: Building2 },
  { href: '/templates', label: 'Templates', icon: FileText },
  { href: '/message', label: 'Send Emails', icon: Mail },
  { href: '/replies', label: 'Replies', icon: Inbox },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/help', label: 'Team Setup', icon: HelpCircle }
];

const groupedRoutes: Record<string, string[]> = {
  '/dashboard': ['/dashboard'],
  '/source-scout': ['/source-scout', '/upload', '/auto-scout', '/email-scout', '/verify'],
  '/businesses': ['/businesses', '/no-inbox', '/data-safety'],
  '/templates': ['/templates'],
  '/message': ['/message', '/deliverability'],
  '/replies': ['/replies'],
  '/settings': ['/settings', '/google-verification'],
  '/help': ['/help', '/challenges']
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
