import { PublicPage, publicIdentity } from '@/components/public/PublicPage';

export const metadata = { title: 'Privacy Policy | Scout' };
export default function PrivacyPage() {
  return <PublicPage title="Privacy Policy" intro="This policy explains how Scout by We Are Creative Builders handles account, prospect, and Google-connected data.">
    <h2>Information Scout processes</h2><p>Scout processes account details, workspace settings, prospect records uploaded or researched by users, templates, sending jobs, delivery records, and connected Gmail authorization tokens.</p>
    <h2>Google user data</h2><p>The initial verified version uses Google authorization to send messages that a signed-in Scout user has instructed Scout to send. Scout stores the authorization token needed to keep the connection working. Scout does not use Google user data for advertising, credit decisions, or sale to data brokers.</p>
    <h2>Google API Services User Data Policy</h2><p>Scout's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>
    <h2>How data is used</h2><p>Data is used to provide Scout features, prevent team duplicates, send user-approved messages, apply sending limits, show activity history, diagnose errors, and protect the service from abuse.</p>
    <h2>Sharing</h2><p>Scout does not sell Google user data. Data may be processed by infrastructure providers needed to operate the service, or disclosed when required by law. Workspace users see only data permitted by Scout's workspace rules.</p>
    <h2>Security and retention</h2><p>OAuth tokens and application data are stored in the service database and are available only to authorized server processes and the applicable workspace. Data is retained while the account is active and removed when the user completes permanent account deletion, except anonymized prospect fingerprints retained solely to prevent duplicate team outreach.</p>
    <h2>User controls</h2><p>Users can disconnect a Gmail account in Scout Settings, revoke Scout in their Google Account permissions, remove sender connections, export available records, or permanently delete their Scout account.</p>
    <h2>Contact</h2><p>Privacy questions may be sent to <a className="detail-link" href={`mailto:${publicIdentity.support}`}>{publicIdentity.support}</a>.</p>
  </PublicPage>;
}
