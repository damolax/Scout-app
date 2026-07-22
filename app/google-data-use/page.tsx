import { PublicPage, publicIdentity } from '@/components/public/PublicPage';

export const metadata = { title: 'Google Data Use | Scout' };
export default function GoogleDataUsePage() {
  return <PublicPage title="How Scout uses Google data" intro="Scout requests only the Google permissions required for sending, Scout-thread reply safety, and optional Gmail signature synchronization.">
    <h2>Permissions requested</h2>
    <ul>
      <li><code>gmail.send</code> lets Scout send messages and replies explicitly started by the signed-in user.</li>
      <li><code>gmail.readonly</code> lets Scout check only Gmail threads created by Scout-sent messages and related delivery-system notices, so it can detect replies, automatic responses, bounces, blocks, temporary failures, unsubscribes, and provider limits.</li>
      <li><code>gmail.settings.basic</code> lets Scout update the connected account’s native Gmail signature only after the user chooses <strong>Save + sync signature</strong>.</li>
    </ul>
    <h2>What Scout stores</h2><ul><li>The connected Gmail address and OAuth tokens needed to keep the authorized connection active.</li><li>Scout message and Gmail thread identifiers.</li><li>Reply and delivery classifications needed to stop unsafe follow-ups.</li><li>The signature text, HTML, and logo chosen by the user.</li></ul>
    <h2>What Scout does not do</h2><ul><li>It does not display or import unrelated inbox conversations.</li><li>It does not sell Google user data or use it for advertising.</li><li>It does not change a Gmail signature unless the user explicitly requests synchronization.</li><li>It does not claim that an MX check proves an exact mailbox exists.</li></ul>
    <h2>Limited Use compliance</h2><p>Scout's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>
    <h2>Control and deletion</h2><p>Users can disconnect Gmail in Settings, revoke Scout in their Google Account, or permanently delete their Scout account. Assistance is available at <a className="detail-link" href={`mailto:${publicIdentity.support}`}>{publicIdentity.support}</a>.</p>
  </PublicPage>;
}
