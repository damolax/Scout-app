import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Scout by We Are Creative Builders',
  description: 'Scout helps teams manage prospects, prevent duplicate outreach, and send responsibly through connected Gmail accounts.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'Scout', statusBarStyle: 'black-translucent' }
};

export const viewport: Viewport = {
  themeColor: '#111827',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
