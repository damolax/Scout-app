import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import { getCurrentWorkspace } from '@/lib/workspace';
import { effectiveDailyLimit, healthLabel, modeLabel, senderHealth, sendingMode } from '@/lib/sending-safety';

type AnyRow = Record<string, any>;

function pct(n: number, d: number) {
  if (!d) return '0%';
  return `${Math.round((n / d) * 1000) / 10}%`;
}

function riskLabel(opts: { bounceRate: number; blocked: number; spamSeeds: number; limitNotices: number; realReplies: number; sent: number }) {
  if (opts.limitNotices > 0) return { label: 'Pause: Gmail limit', tone: 'danger' };
  if (opts.blocked > 0 || opts.spamSeeds > 0 || opts.bounceRate >= 8) return { label: 'High risk', tone: 'danger' };
  if (opts.bounceRate >= 3 || (opts.sent > 150 && opts.realReplies === 0)) return { label: 'Watch', tone: 'warn' };
  return { label: 'OK', tone: 'success' };
}

async function safeRows<T = AnyRow>(promise: PromiseLike<{ data: T[] | null; error: any }>) {
  const { data, error } = await promise;
  if (error) return [] as T[];
  return (data || []) as T[];
}

export default async function DeliverabilityPage() {
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();
  if (!workspace) {
    return <div className="card"><h2>Deliverability</h2><p className="error">No workspace is available for this account.</p></div>;
  }

  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [summaryResult, recentFailures, recentSeeds] = await Promise.all([
    supabase.rpc('scout_deliverability_sender_summary', { p_workspace_id: workspace.id }),
    safeRows<AnyRow>(supabase.from('no_inbox_records').select('id,email,to_email,reason,status,type,from_email,created_at').eq('workspace_id', workspace.id).gte('created_at', since7).order('created_at', { ascending: false }).limit(20)),
    safeRows<AnyRow>(supabase.from('seed_inbox_tests').select('id,sender_email,seed_email,placement,checked_at,created_at').eq('workspace_id', workspace.id).gte('created_at', since7).order('created_at', { ascending: false }).limit(20)),
  ]);

  const rows = summaryResult.error ? [] : ((summaryResult.data || []) as AnyRow[]);
  const bySender = rows.map((account) => {
    const sent = Number(account.sent_7d || 0);
    const noInbox = Number(account.no_inbox_7d || 0);
    const blocked = Number(account.blocked_7d || 0);
    const realReplies = Number(account.real_replies_7d || 0);
    const autoReplies = Number(account.auto_replies_7d || 0);
    const limitNotices = Number(account.limit_notices_7d || 0);
    const seedTests = Number(account.seed_tests_7d || 0);
    const spamSeeds = Number(account.spam_seeds_7d || 0);
    const bounceRate = sent ? (noInbox / sent) * 100 : 0;
    const risk = riskLabel({ bounceRate, blocked, spamSeeds, limitNotices, realReplies, sent });
    return {
      account,
      email: String(account.email || '').toLowerCase(),
      sent,
      rolling24h: Number(account.sent_24h || 0),
      safeLimit: effectiveDailyLimit(account),
      mode: sendingMode(account),
      health: senderHealth(account),
      noInbox,
      blocked,
      realReplies,
      autoReplies,
      limitNotices,
      seedTests,
      spamSeeds,
      bounceRate,
      risk,
    };
  });

  const totalSent = bySender.reduce((sum, row) => sum + row.sent, 0);
  const totalNoInbox = bySender.reduce((sum, row) => sum + row.noInbox, 0);
  const totalRealReplies = bySender.reduce((sum, row) => sum + row.realReplies, 0);
  const totalBlocked = bySender.reduce((sum, row) => sum + row.blocked, 0);
  const totalSpamSeeds = bySender.reduce((sum, row) => sum + row.spamSeeds, 0);

  return (
    <div className="stack">
      <div>
        <h2>Deliverability Dashboard</h2>
        <p className="muted">See sender risk without loading thousands of message rows. Scout calculates seven-day summaries in one grouped database query.</p>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Sent · 7 days</div><div className="num">{totalSent.toLocaleString()}</div><p className="muted">Tracked sent messages.</p></div>
        <div className="card kpi"><div className="title">No Inbox / Bounce</div><div className="num">{totalNoInbox.toLocaleString()}</div><p className="muted">Bounce rate: {pct(totalNoInbox, totalSent)}</p></div>
        <div className="card kpi"><div className="title">Replies</div><div className="num">{totalRealReplies.toLocaleString()}</div><p className="muted">Reply rate: {pct(totalRealReplies, totalSent)}</p></div>
        <div className="card kpi"><div className="title">Seed Spam Hits</div><div className="num">{totalSpamSeeds.toLocaleString()}</div><p className="muted">Blocked notices: {totalBlocked.toLocaleString()}</p></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Sender Risk</h3>
        <p className="muted">The table uses grouped statistics, so 150 connected accounts do not trigger thousands of browser or database queries.</p>
        <div className="table-wrap"><table><thead><tr><th>Sender</th><th>Safety mode</th><th>Health / Risk</th><th>Sent 7d</th><th>Rolling 24h</th><th>No Inbox</th><th>Blocked</th><th>Replies</th><th>Auto-Like</th><th>Seed Spam</th><th>Action</th></tr></thead><tbody>
          {bySender.map((row) => <tr key={row.account.id}>
            <td><strong>{row.email}</strong><br /><span className="muted">Run max: {row.account.default_run_limit || 50} · daily max: {row.account.daily_limit || 250}</span></td>
            <td>{modeLabel(row.mode)}<br /><span className="muted">Effective today: {Number.isFinite(row.safeLimit) ? row.safeLimit : row.account.daily_limit || 250}</span></td>
            <td><span className={`status ${row.risk.tone === 'danger' ? 'failed' : row.risk.tone === 'warn' ? 'review' : 'ready'}`}>{row.risk.label}</span><br /><span className="muted">{healthLabel(row.health)}</span></td>
            <td>{row.sent}</td>
            <td>{row.rolling24h}</td>
            <td>{row.noInbox} <span className="muted">({pct(row.noInbox, row.sent)})</span></td>
            <td>{row.blocked}</td>
            <td>{row.realReplies}</td>
            <td>{row.autoReplies}</td>
            <td>{row.spamSeeds}/{row.seedTests}</td>
            <td><Link href="/settings">Adjust sender</Link></td>
          </tr>)}
          {!bySender.length ? <tr><td colSpan={11} className="muted">No Gmail sender accounts found. Connect Gmail in Settings.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <h3>Recent Delivery Failures</h3>
          <div className="table-wrap"><table><thead><tr><th>Email</th><th>Reason</th><th>Sender</th><th>Time</th></tr></thead><tbody>
            {recentFailures.map((row, index) => <tr key={row.id || index}><td>{row.email || row.to_email || '-'}</td><td>{row.reason || row.status || row.type || '-'}</td><td>{row.from_email || '-'}</td><td>{row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</td></tr>)}
            {!recentFailures.length ? <tr><td colSpan={4} className="muted">No delivery failures in the last 7 days.</td></tr> : null}
          </tbody></table></div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <h3>Recent Seed Inbox Tests</h3>
          <div className="table-wrap"><table><thead><tr><th>Sender</th><th>Seed</th><th>Placement</th><th>Time</th></tr></thead><tbody>
            {recentSeeds.map((row, index) => <tr key={row.id || index}><td>{row.sender_email || '-'}</td><td>{row.seed_email || '-'}</td><td>{row.placement || '-'}</td><td>{row.checked_at || row.created_at ? new Date(row.checked_at || row.created_at).toLocaleString() : '-'}</td></tr>)}
            {!recentSeeds.length ? <tr><td colSpan={4} className="muted">No placement tests yet. Open Settings, choose two inboxes you own, and send one controlled test.</td></tr> : null}
          </tbody></table></div>
        </div>
      </div>

      <div className="notice">
        <strong>Rule for decisions:</strong> if a sender shows high no-inbox, blocked messages, spam seed placement, or Gmail limit notices, switch it to Warm-up / Recovery or reduce its limits in <Link href="/settings">Settings</Link> before sending again.
      </div>
    </div>
  );
}
