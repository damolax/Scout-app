import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import { getCurrentWorkspace } from '@/lib/workspace';
import { isScoutAdminEmail } from '@/lib/admin';
import { featureFlags } from '@/lib/feature-flags';

function item(label: string, detail: string, ready = true) {
  return { label, detail, ready };
}

export default async function GoogleVerificationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isScoutAdminEmail(user?.email)) return <div className="error">Only the main Scout admin can open Google Verification.</div>;
  const { workspace } = await getCurrentWorkspace();
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || workspace?.app_url || '').replace(/\/$/, '');
  const supportEmail = String(process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '').trim();
  const checks = [
    item('App identity', 'Scout by We Are Creative Builders'),
    item('Production domain', appUrl || 'Set NEXT_PUBLIC_APP_URL and the workspace App URL.', Boolean(appUrl)),
    item('Homepage', appUrl ? `${appUrl}/` : 'Waiting for production domain', Boolean(appUrl)),
    item('Privacy policy', appUrl ? `${appUrl}/privacy` : 'Waiting for production domain', Boolean(appUrl)),
    item('Terms of service', appUrl ? `${appUrl}/terms` : 'Waiting for production domain', Boolean(appUrl)),
    item('Data deletion', appUrl ? `${appUrl}/data-deletion` : 'Waiting for production domain', Boolean(appUrl)),
    item('Google data use', appUrl ? `${appUrl}/google-data-use` : 'Waiting for production domain', Boolean(appUrl)),
    item('Support contact', supportEmail || 'Set NEXT_PUBLIC_SUPPORT_EMAIL to your real support address.', Boolean(supportEmail)),
    item('OAuth callback', appUrl ? `${appUrl}/api/gmail/oauth/callback` : 'Waiting for production domain', Boolean(appUrl)),
    item('OAuth scope', 'openid, email, profile, gmail.send'),
    item('Reply reading', featureFlags.gmailReplySync ? 'Enabled — requires advanced authorization.' : 'Disabled during send-only verification.'),
    item('Gmail signature settings', featureFlags.gmailNativeSignatureSync ? 'Enabled — requires advanced authorization.' : 'Disabled during send-only verification.'),
  ];

  return <div className="stack">
    <div className="topbar"><div className="page-title"><h2>Google Verification</h2><p>Admin-only checklist for the send-only Scout submission.</p></div><span className="badge">Admin only</span></div>
    <div className="notice"><strong>Submission scope:</strong> Scout connects Gmail for sending. It does not read the inbox or change Gmail’s native signature in this verification release.</div>
    <div className="card" style={{ padding: 18 }}>
      <h3>Production checklist</h3>
      <div className="table-wrap"><table><thead><tr><th>Item</th><th>Status</th><th>Value</th></tr></thead><tbody>{checks.map((check) => <tr key={check.label}><td>{check.label}</td><td><span className={`status ${check.ready ? 'connected' : 'paused'}`}>{check.ready ? 'Ready' : 'Action needed'}</span></td><td><code>{check.detail}</code></td></tr>)}</tbody></table></div>
    </div>
    <div className="card" style={{ padding: 18 }}>
      <h3>Scope justification</h3>
      <p>Scout uses the Gmail send permission only after a signed-in user explicitly connects their Gmail account and explicitly starts or schedules an outreach job. Scout constructs and sends the user-selected message through that connected account, records delivery metadata needed to show sending progress, and allows the user to disconnect the account. This release does not request inbox-reading or Gmail-settings access.</p>
    </div>
    <div className="card" style={{ padding: 18 }}>
      <h3>Verification video sequence</h3>
      <ol>
        <li>Open the public Scout homepage, Privacy, Terms, Data Deletion, and Google Data Use pages.</li>
        <li>Sign in to Scout and open Settings.</li>
        <li>Click Connect Gmail for sending and show the complete Google consent screen.</li>
        <li>Return to Settings and show the connected sender.</li>
        <li>Send one controlled test message through Scout and show the Sent record.</li>
        <li>Remove the Gmail connection and show the account-deletion controls.</li>
      </ol>
      <div className="actions"><Link className="btn secondary" href="/settings">Open Settings</Link><Link className="btn secondary" href="/message">Open Send Emails</Link></div>
    </div>
  </div>;
}
