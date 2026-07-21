import { PublicPage, publicIdentity } from '@/components/public/PublicPage';

export const metadata = { title: 'Data Deletion | Scout' };
export default function DataDeletionPage() {
  return <PublicPage title="Account and data deletion" intro="Scout users can permanently delete their account and connected data from inside Settings.">
    <h2>Delete from Scout</h2><ol><li>Sign in to Scout.</li><li>Open Data Safety.</li><li>Open Permanent account deletion.</li><li>Type <code>DELETE</code> exactly and confirm.</li></ol>
    <p>The process removes the authentication account, profile, workspace membership, Gmail connections and tokens, templates, jobs, sent and reply history, settings, and user-specific records.</p>
    <h2>Duplicate-prevention record</h2><p>Scout retains only anonymized prospect fingerprints needed to stop the same business from being reassigned and contacted again by the team. The deleted user's name, email, user ID, and workspace ID are removed from that retained record.</p>
    <h2>Revoke Google access</h2><p>Users may also revoke Scout from the third-party access section of their Google Account. Revocation prevents future token use but does not by itself delete the Scout account; use the in-app deletion control for full removal.</p>
    <h2>Deletion assistance</h2><p>When access to the account is unavailable, contact <a className="detail-link" href={`mailto:${publicIdentity.support}?subject=Scout%20data%20deletion`}>{publicIdentity.support}</a> from the registered email address.</p>
  </PublicPage>;
}
