import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Scout App v8 Cloud',
  description: 'Cloud Scout App with Supabase login, team dedupe, imports, Gmail backend integration, and extension-friendly workflow.',
  manifest: '/manifest.json',
  themeColor: '#111827',
  appleWebApp: { capable: true, title: 'Scout', statusBarStyle: 'black-translucent' }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
