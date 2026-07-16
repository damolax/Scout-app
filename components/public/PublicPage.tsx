import Link from 'next/link';

const brand = process.env.NEXT_PUBLIC_SCOUT_BRAND_NAME || 'Scout by We Are Creative Builders';
const support = String(process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '').trim();

export function PublicHeader() {
  return (
    <header className="public-header">
      <Link href="/" className="public-brand"><span className="logo" aria-hidden="true" /><span><strong>{brand}</strong><small>Responsible outreach workspace</small></span></Link>
      <nav className="public-nav" aria-label="Public navigation">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/contact">Contact</Link>
        <Link className="btn" href="/login">Open Scout</Link>
      </nav>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <span>© {new Date().getFullYear()} We Are Creative Builders</span>
      <span className="public-footer-links"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/data-deletion">Data deletion</Link><Link href="/google-data-use">Google data use</Link>{support ? <a href={`mailto:${support}`}>{support}</a> : <span>Support email not configured</span>}</span>
    </footer>
  );
}

export function PublicPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return <main className="public-shell"><PublicHeader /><article className="public-article"><span className="badge">{brand}</span><h1>{title}</h1><p className="public-lead">{intro}</p>{children}</article><PublicFooter /></main>;
}

export const publicIdentity = { brand, support };
