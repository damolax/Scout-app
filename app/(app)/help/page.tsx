import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import { SCOUT_SCHEMA_CONTRACT_VERSION } from '@/lib/schema-readiness';

const workflow = [
  ['1. Confirm setup', 'Open Settings and run Setup Readiness after applying the unified Scout SQL migration.'],
  ['2. Add a sender', 'Open Sending Accounts. Enable Google 2-Step Verification, create an App Password, and connect that Gmail account through SMTP.'],
  ['3. Choose a Scout', 'Open Scout and choose Authors, Shopify Stores, Website Design, Automation Prospects, Planner Prospects, or Custom Scout.'],
  ['4. Let enrichment run', 'Website-only prospects can remain in Scout while the background email-research worker checks public contact pages.'],
  ['5. Run Intelligence when useful', 'Analyze a prospect website before outreach to identify evidence-backed customer-journey and service opportunities.'],
  ['6. Prepare outreach', 'Use templates and selected prospects to create an initial campaign or follow-up campaign.'],
  ['7. Schedule and leave', 'Scout’s server-side sending worker continues scheduled SMTP campaigns after you close the browser.'],
  ['8. Review outcomes', 'Track sent status and manually record replies when Gmail reply sync is not enabled.']
];

const acceptance = [
  'A Gmail App Password sender passes the SMTP connection test.',
  'A controlled test message is delivered from the exact Gmail address connected in Sending Accounts.',
  'A scheduled campaign continues through the server-side worker after the Scout browser tab is closed.',
  'An Author Scout job continues in the Author Scout worker and its results appear in Prospects.',
  'Shopify, website-design, automation, planner and custom Scout results are tagged with their prospect type.',
  'A website-only prospect is queued for background email enrichment.',
  'Opportunity Intelligence saves an analysis to the same Scout workspace and updates the linked prospect opportunity score.',
  'A normal member cannot access another workspace’s data or sender credentials.'
];

export default async function HelpPage() {
  const { workspace } = await getCurrentWorkspace();
  return <div className="stack">
    <div className="topbar"><div className="page-title"><h2>Team Setup</h2><p>Unified Scout setup and daily workflow.</p></div><span className="badge">Schema {SCOUT_SCHEMA_CONTRACT_VERSION}</span></div>
    <div className="notice"><strong>Installation owner:</strong> create the intended owner account first on a fresh installation. Do not share the URL until Settings reports Ready.</div>
    <div className="card" style={{ padding: 18 }}><h3>Required order</h3><ol>{workflow.map(([title, detail]) => <li key={title} style={{ marginBottom: 12 }}><strong>{title}</strong><div className="muted">{detail}</div></li>)}</ol></div>
    <div className="card" style={{ padding: 18 }}><h3>Acceptance tests before team use</h3><ul>{acceptance.map((item) => <li key={item} style={{ marginBottom: 8 }}>{item}</li>)}</ul></div>
    <div className="card" style={{ padding: 18 }}><h3>Daily workflow</h3><p className="muted">Choose a Scout → find and enrich prospects → run Intelligence when useful → prepare outreach → schedule sending → review outcomes.</p><div className="actions"><Link className="btn" href="/settings">Open Settings</Link><Link className="btn secondary" href="/sending-accounts">Sending Accounts</Link><Link className="btn secondary" href="/intelligence">Intelligence</Link><Link className="btn secondary" href="/data-safety">Data Safety</Link></div></div>
    <div className="card" style={{ padding: 18 }}><h3>Current workspace</h3><p><strong>{workspace?.name || 'No workspace available'}</strong></p><p className="muted">App URL: {workspace?.app_url || 'Not saved yet'}<br />Workspace key: {workspace?.api_key ? 'Created' : 'Missing — run the current SQL'}</p></div>
  </div>;
}
