import { PublicPage, publicIdentity } from '@/components/public/PublicPage';

export const metadata = { title: 'Terms of Service | Scout' };
export default function TermsPage() {
  return <PublicPage title="Terms of Service" intro="These terms govern use of Scout by We Are Creative Builders.">
    <h2>User responsibility</h2><p>Users are responsible for the recipients, content, legal basis, consent requirements, and sending practices associated with their outreach. Scout must not be used for deceptive, abusive, unlawful, or unsolicited bulk messaging that violates provider rules or applicable law.</p>
    <h2>No deliverability guarantee</h2><p>Scout provides pacing, suppression, verification, and risk warnings, but cannot guarantee inbox placement, replies, sales, or uninterrupted access to Gmail or other third-party services.</p>
    <h2>Google accounts</h2><p>Users may connect only accounts they own or are authorized to operate. Google may impose independent quotas, security checks, suspensions, or verification requirements.</p>
    <h2>Acceptable use</h2><p>Users must honor opt-out requests, avoid misleading headers or subjects, maintain accurate sender identity, and stop sending to invalid or suppressed recipients.</p>
    <h2>Service changes</h2><p>Features may be changed to protect users, comply with provider requirements, improve security, or maintain service reliability. Material changes will be reflected in the product or these terms.</p>
    <h2>Contact</h2><p>Questions may be sent to <a className="detail-link" href={`mailto:${publicIdentity.support}`}>{publicIdentity.support}</a>.</p>
  </PublicPage>;
}
