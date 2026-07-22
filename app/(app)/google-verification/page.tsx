import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import { featureFlags } from '@/lib/feature-flags';

function item(label: string, detail: string, ready = true) {
  return { label, detail, ready };
}

export default async function GoogleVerificationPage() {
  const { workspace } = await getCurrentWorkspace();
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || workspace?.app_url || '').replace(/\/$/, '');
  const supportEmail = String(process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '').trim();
  const checks = [
    item('Production domain', appUrl || 'Set NEXT_PUBLIC_APP_URL and the workspace App URL.', Boolean(appUrl)),
    item('Homepage', appUrl ? `${appUrl}/` : 'Waiting for production domain', Boolean(appUrl)),
    item('Privacy policy', appUrl ? `${appUrl}/privacy` : 'Waiting for production domain', Boolean(appUrl)),
    item('Terms of service', appUrl ? `${appUrl}/terms` : 'Waiting for production domain', Boolean(appUrl)),
    item('Data deletion', appUrl ? `${appUrl}/data-deletion` : 'Waiting for production domain', Boolean(appUrl)),
    item('Google data use', appUrl ? `${appUrl}/google-data-use` : 'Waiting for production domain', Boolean(appUrl)),
    item('Support contact', supportEmail || 'Set NEXT_PUBLIC_SUPPORT_EMAIL.', Boolean(supportEmail)),
    item('OAuth callback', appUrl ? `${appUrl}/api/gmail/oauth/callback` : 'Waiting for production domain', Boolean(appUrl)),
    item('OAuth scopes', 'openid, email, profile, gmail.send, gmail.readonly, gmail.settings.basic'),
    item('Inbox/reply reading', featureFlags.gmailReplySync ? 'Enabled for Scout-created threads and related delivery notices' : 'Disabled by configuration'),
    item('Native Gmail signature editing', featureFlags.gmailNativeSignatureSync ? 'Enabled when the user chooses Save + sync signature' : 'Disabled by configuration'),
    item('Placement tests', featureFlags.placementTests ? 'Enabled' : 'Not included in this zero-paid-API release'),
  ];

  return <div className="stack">
    <div className="topbar"><div className="page-title"><h2>Google Verification</h2><p>Production checklist for Scout sending, scoped reply detection, and Gmail signature synchronization.</p></div><span className="badge">Full validation</span></div>
    <div className="notice"><strong>Current submission:</strong> Scout requests Google identity, Gmail sending, read-only Gmail access used only for Scout-created threads and related delivery notices, and Gmail signature settings used only when the user chooses Save + sync signature. Scout does not display unrelated inbox conversations.</div>
    <div className="card" style={{ padding: 18 }}><h3>Production checklist</h3><div className="table-wrap"><table><thead><tr><th>Item</th><th>Status</th><th>Value</th></tr></thead><tbody>{checks.map((check) => <tr key={check.label}><td>{check.label}</td><td><span className={`status ${check.ready ? 'connected' : 'paused'}`}>{check.ready ? 'Ready' : 'Action needed'}</span></td><td><code>{check.detail}</code></td></tr>)}</tbody></table></div></div>
    <div className="card" style={{ padding: 18 }}><h3>Scope justification</h3><p>Scout sends only messages explicitly created and started by the signed-in user. It stores authorization tokens and the Gmail message/thread identifiers returned for Scout-sent messages. Read-only Gmail access is used by server code only to inspect Scout-created threads and related delivery-system notices. Unrelated inbox conversations are not displayed or imported.</p></div>
    <div className="card" style={{ padding: 18 }}><h3>Verification video sequence</h3><ol><li>Show the public homepage, Privacy, Terms, Data Deletion, and Google Data Use pages.</li><li>Sign in and open Settings.</li><li>Click Connect Gmail and show the full consent screen.</li><li>Return to Settings and click Check Gmail connection.</li><li>Send one controlled test message through Scout.</li><li>Reply from another account and click Check replies now.</li><li>Show the real reply classification and that follow-ups stop.</li><li>Save and synchronize a test Gmail signature.</li><li>Open Data Safety and show account deletion.</li></ol><div className="actions"><Link className="btn secondary" href="/settings">Open Settings</Link><Link className="btn secondary" href="/message">Open Send Emails</Link><Link className="btn secondary" href="/data-safety">Open Data Safety</Link></div></div>
  </div>;
}
