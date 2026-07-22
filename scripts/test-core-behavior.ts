import { classifyInboundForTest } from '../lib/gmail-inbound-sync';
import { appendSignatureToText, buildHtmlBody } from '../lib/email-signature';

const cases = [
  ['real', { from:'buyer@example.com', subject:'Re: Website', body:'Thanks. Can you send more details?' }, 'real_reply'],
  ['auto', { from:'support@example.com', subject:'Automatic reply', body:'This is an automated response. Your ticket has been created.' }, 'auto_reply'],
  ['no inbox', { from:'mailer-daemon@example.com', subject:'Delivery Status Notification', body:'550 5.1.1 address not found' }, 'no_inbox'],
  ['blocked', { from:'postmaster@example.com', subject:'Message blocked', body:'Rejected as spam due to policy violation' }, 'message_blocked'],
  ['bounce', { from:'mailer-daemon@example.com', subject:'Undeliverable', body:'Delivery has failed permanently' }, 'bounce_notice'],
  ['limit', { from:'mailer-daemon@example.com', subject:'Sending limit', body:'Daily user sending quota exceeded' }, 'gmail_limit_notice'],
  ['temporary', { from:'postmaster@example.com', subject:'Deferred', body:'Temporary failure. Try again later.' }, 'temporary_failure'],
  ['self', { from:'sender@example.com', accountEmail:'sender@example.com', subject:'Sent copy', body:'hello' }, 'self_message_ignored'],
  ['unsubscribe', { from:'buyer@example.com', subject:'Re: Website', body:'Please unsubscribe me and stop contacting us.' }, 'unsubscribe_request'],
  ['unmatched', { from:'random@example.com', matched:false, subject:'Hello', body:'Unrelated message' }, 'unmatched_inbound'],
] as const;
let failures=0;
for (const [name,input,expected] of cases) {
  const result=classifyInboundForTest(input);
  const ok=result.classification===expected;
  console.log(`${ok?'PASS':'FAIL'} ${name}: ${result.classification}`);
  if(!ok) failures++;
}
const identity={signature_enabled:true,signature_text:'Best regards,\nScout Team',signature_html:'<strong>Scout Team</strong>'};
const once=appendSignatureToText('Hello',identity);
const twice=appendSignatureToText(once,identity);
const htmlOnce=buildHtmlBody(once,identity);
const signatureOccurrences=(htmlOnce.match(/Scout Team/g)||[]).length;
const signatureOk=once===twice && signatureOccurrences===1;
console.log(`${signatureOk?'PASS':'FAIL'} signature idempotence`);
if(!signatureOk) failures++;
if(failures) process.exit(1);
console.log(`Core behavior tests passed: ${cases.length} classifications + signature idempotence.`);
