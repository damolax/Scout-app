import Link from 'next/link';
import { PublicFooter, PublicHeader } from '@/components/public/PublicPage';

export default function Home() {
  return (
    <main className="public-shell">
      <PublicHeader />
      <section className="public-hero">
        <div>
          <span className="badge">Scout by We Are Creative Builders</span>
          <h1>Find prospects, protect team ownership, and send outreach from connected Gmail accounts.</h1>
          <p>Scout helps teams organize leads, avoid duplicate prospecting, prepare messages, apply one shared signature, and send only after a user starts a job.</p>
          <div className="actions"><Link className="btn" href="/login">Sign in to Scout</Link><Link className="btn secondary" href="/google-data-use">How Google data is used</Link></div>
        </div>
        <div className="card public-feature-card">
          <h2>What Scout does</h2>
          <ul>
            <li>Connects Gmail with the minimum permission needed to send.</li>
            <li>Uses team-wide duplicate protection before scouting and sending.</li>
            <li>Applies sender limits, pacing, suppression, and deliverability warnings.</li>
            <li>Lets users disconnect Gmail and delete their Scout account data.</li>
          </ul>
          <div className="notice">Scout does not guarantee inbox placement and does not send messages without an explicit user-created job.</div>
        </div>
      </section>
      <section className="public-grid">
        <div className="card"><h3>Simple workflow</h3><p>Connect Gmail, select a template and recipients, then send. Scout shows a warning only when something needs attention.</p></div>
        <div className="card"><h3>Safer sending</h3><p>New and recovering accounts use slower pacing. Healthy accounts can use faster sending within strict limits.</p></div>
        <div className="card"><h3>Google access</h3><p>Scout requests Gmail sending, read-only access limited by the app to Scout-created threads and related delivery notices, and Gmail signature settings so users can synchronize the signature they choose.</p></div>
      </section>
      <PublicFooter />
    </main>
  );
}
