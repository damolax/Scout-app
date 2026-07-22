import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import { SCOUT_SCHEMA_CONTRACT_VERSION } from '@/lib/schema-readiness';

const workflow = [
  ['1. Confirm setup', 'Open Settings and run Setup Readiness. Do not connect Gmail until the schema contract, environment, and worker checks pass.'],
  ['2. Connect Gmail', 'Approve sending, Scout-thread read-only access, and Gmail signature settings. Older send-only connections must reconnect.'],
  ['3. Save identity', 'Add the shared Scout signature, then use Save + sync signature. Open each sender’s details and confirm Gmail signature sync succeeded.'],
  ['4. Add leads', 'Use Find Leads, Upload CSV, or the extension. Verify email format and MX before sending.'],
  ['5. Send a controlled batch', 'Start with one address you control, then increase gradually within Scout’s sender-health allowance.'],
  ['6. Check replies', 'Replies collects messages only from Scout-created threads and related delivery notices. Review real replies first.'],
  ['7. Follow up safely', 'Use Follow-up 1 and Follow-up 2 only. Scout excludes real replies, unsubscribes, bounces, blocked addresses, and invalid inboxes.'],
];

const acceptance = [
  'One controlled initial message is delivered and contains the signature exactly once.',
  'Save + sync signature updates the native Gmail signature for the connected sender.',
  'A real reply appears under Replies and removes the lead from follow-up eligibility.',
  'An automatic/out-of-office response appears under Automatic messages, not Real replies.',
  'A bounce or no-inbox notice suppresses the recipient.',
  'Running Check replies twice does not create duplicate records.',
  'The scheduled inbound worker shows a successful run in Supabase Cron history.',
  'A normal member cannot view or delete another member’s workspace data.',
];

export default async function HelpPage() {
  const { workspace } = await getCurrentWorkspace();
  return <div className="stack">
    <div className="topbar"><div className="page-title"><h2>Team Setup</h2><p>One clear setup and daily-use guide for Scout v10.40.0.</p></div><span className="badge">Schema {SCOUT_SCHEMA_CONTRACT_VERSION}</span></div>
    <div className="notice"><strong>Installation owner:</strong> create the intended owner account first on a fresh installation. Do not share the URL until Settings reports Ready.</div>
    <div className="card" style={{ padding: 18 }}><h3>Required order</h3><ol>{workflow.map(([title, detail]) => <li key={title} style={{ marginBottom: 12 }}><strong>{title}</strong><div className="muted">{detail}</div></li>)}</ol></div>
    <div className="card" style={{ padding: 18 }}><h3>Acceptance tests before team use</h3><ul>{acceptance.map((item) => <li key={item} style={{ marginBottom: 8 }}>{item}</li>)}</ul></div>
    <div className="card" style={{ padding: 18 }}><h3>Daily workflow</h3><p className="muted">Find or import leads → verify → prepare templates → send a controlled batch → check Replies → answer real replies → send staged follow-ups.</p><div className="actions"><Link className="btn" href="/settings">Open Settings</Link><Link className="btn secondary" href="/replies">Open Replies</Link><Link className="btn secondary" href="/google-verification">Google Review</Link><Link className="btn secondary" href="/data-safety">Data Safety</Link></div></div>
    <div className="card" style={{ padding: 18 }}><h3>Current workspace</h3><p><strong>{workspace?.name || 'No workspace available'}</strong></p><p className="muted">App URL: {workspace?.app_url || 'Not saved yet'}<br />Workspace key: {workspace?.api_key ? 'Created' : 'Missing — run the current SQL'}</p></div>
  </div>;
}
