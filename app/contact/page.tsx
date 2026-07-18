import { PublicPage, publicIdentity } from '@/components/public/PublicPage';

export const metadata = { title: 'Contact | Scout' };
export default function ContactPage() {
  return <PublicPage title="Contact Scout" intro="Support and privacy requests are handled by We Are Creative Builders.">
    <div className="card" style={{ padding: 22 }}><h2>Email support</h2><p><a className="detail-link" href={`mailto:${publicIdentity.support}`}>{publicIdentity.support}</a></p><p className="muted">For account deletion, send from the registered Scout email address. Do not email passwords, access tokens, or private keys.</p></div>
  </PublicPage>;
}
