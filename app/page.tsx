import Link from 'next/link';
import { PublicFooter, PublicHeader } from '@/components/public/PublicPage';

export default function Home() {
  return (
    <main className="public-shell">
      <PublicHeader />
      <section className="public-hero">
        <div>
          <span className="badge">Scout by We Are Creative Builders</span>
          <h1>Find the right prospects, understand the opportunity, and run outreach from one Scout workspace.</h1>
          <p>Scout combines multi-type prospect discovery, background author scouting, website intelligence, email enrichment, team duplicate protection, and scheduled outreach.</p>
          <div className="actions"><Link className="btn" href="/login">Sign in to Scout</Link><Link className="btn secondary" href="/login">Open Scout</Link></div>
        </div>
        <div className="card public-feature-card">
          <h2>What Scout does</h2>
          <ul>
            <li>Supports Gmail App Password + SMTP sending without making Gmail OAuth a requirement.</li>
            <li>Uses team-wide duplicate protection before scouting and sending.</li>
            <li>Applies sender limits, pacing, suppression, and deliverability warnings.</li>
            <li>Keeps authors, stores, businesses and custom prospects in one workspace.</li>
          </ul>
          <div className="notice">Scout does not guarantee inbox placement and does not send messages without an explicit user-created job.</div>
        </div>
      </section>
      <section className="public-grid">
        <div className="card"><h3>Simple workflow</h3><p>Choose a Scout type, review qualified prospects, run Opportunity Intelligence when useful, then prepare outreach.</p></div>
        <div className="card"><h3>Safer sending</h3><p>New and recovering accounts use slower pacing. Healthy accounts can use faster sending within strict limits.</p></div>
        <div className="card"><h3>Automatic sending</h3><p>Authorized Gmail senders can use encrypted App Password credentials over SMTP, while Scout’s server-side queue continues scheduled campaigns after the browser is closed.</p></div>
      </section>
      <PublicFooter />
    </main>
  );
}
