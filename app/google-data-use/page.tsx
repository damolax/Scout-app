import { PublicPage, publicIdentity } from '@/components/public/PublicPage';

export const metadata = { title: 'Google Data Use | Scout' };
export default function GoogleDataUsePage() {
  return <PublicPage title="How Scout uses Google data" intro="Scout requests the minimum Google permission used by the initial production release.">
    <h2>Permission requested</h2><p><code>https://www.googleapis.com/auth/gmail.send</code> allows Scout to send a message from a connected Gmail account after the user creates and starts a Scout sending job.</p>
    <h2>What Scout does</h2><ul><li>Obtains the connected Gmail address.</li><li>Stores OAuth access and refresh tokens needed to keep the authorized connection active.</li><li>Builds the user-selected message and Scout signature.</li><li>Sends the message through Gmail and stores the resulting message/thread identifiers and Scout delivery history.</li></ul>
    <h2>What Scout does not do in this release</h2><ul><li>It does not read the user's general Gmail inbox.</li><li>It does not automatically import new replies.</li><li>It does not change the signature configured inside Gmail.</li><li>It does not sell Google user data or use it for advertising.</li></ul>
    <h2>Limited Use compliance</h2><p>Scout's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>
    <h2>Control and deletion</h2><p>Users can remove a connected Gmail account in Settings, revoke access in their Google Account, or permanently delete their Scout account. Assistance is available at <a className="detail-link" href={`mailto:${publicIdentity.support}`}>{publicIdentity.support}</a>.</p>
  </PublicPage>;
}
