import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const failures = [];
const pass = [];

function check(name, condition, detail = '') {
  if (condition) pass.push(name);
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const oauthStart = read('app/api/gmail/oauth/start/route.ts');
const oauthCallback = read('app/api/gmail/oauth/callback/route.ts');
const emailScout = read('app/(app)/email-scout/EmailScoutClient.tsx');
const flags = read('lib/feature-flags.ts');
const settings = read('app/(app)/settings/SettingsClient.tsx');
const send = read('app/api/gmail/send/route.ts');
const schedules = read('app/api/message/run-schedules/route.ts');
const reply = read('app/api/gmail/reply/route.ts');
const seed = read('app/api/gmail/seed-test/run/route.ts');
const safety = read('lib/sending-safety.ts');
const sql = read('RUN_THIS_SQL_FIRST_V10_35.sql');
const team = read('app/(app)/team/TeamClient.tsx');
const accountDelete = read('app/api/account/delete/route.ts');
const privacy = read('app/privacy/page.tsx');
const dataUse = read('app/google-data-use/page.tsx');
const autoSync = read('app/api/gmail/auto-sync/route.ts');
const syncReplies = read('app/api/gmail/sync-replies/route.ts');
const syncBounces = read('app/api/gmail/sync-bounces/route.ts');

check('Send-only OAuth includes gmail.send', oauthStart.includes('https://www.googleapis.com/auth/gmail.send'));
check('OAuth excludes restricted Gmail scopes', !/gmail\.(readonly|settings\.basic|modify|metadata|compose)|https:\/\/mail\.google\.com\//.test(oauthStart));
check('OAuth state is signed and session-bound', oauthStart.includes('encodeOauthState') && oauthCallback.includes('decodeAndVerifyOauthState') && oauthCallback.includes('user.id !== state.user_id'));
check('Send-only callback uses OpenID userinfo, not Gmail profile', oauthCallback.includes('openidconnect.googleapis.com/v1/userinfo') && !oauthCallback.includes('/gmail/v1/users/me/profile'));
check('Legacy Email Scout uses native OAuth route', emailScout.includes('/api/gmail/oauth/start') && !emailScout.includes('accounts.google.com/o/oauth2'));
check('Reply sync is retained but disabled by default', flags.includes("gmailReplySync: enabled('GMAIL_REPLY_SYNC_ENABLED', false)"));
check('Native Gmail signature sync is retained but disabled by default', flags.includes("gmailNativeSignatureSync: enabled('GMAIL_NATIVE_SIGNATURE_SYNC_ENABLED', false)"));
check('Restricted Gmail sync routes require workspace access before service-role reads', [autoSync, syncReplies, syncBounces].every((text) => text.includes('requireWorkspaceAccess(workspaceId)')));
check('Scout signature save/copy remains simple', settings.includes('Save to Scout') && settings.includes('Copy signature for Gmail'));
check('Direct sends reserve atomic capacity', send.includes('reserveSingleSenderSlot') && send.includes('finalizeSingleSenderSlot'));
check('Scheduled sends use atomic capacity', schedules.includes("reserve_scout_sender_slot") && schedules.includes("finalize_scout_sender_slot"));
check('Manual replies use atomic capacity', reply.includes('reserveSingleSenderSlot') && reply.includes('finalizeSingleSenderSlot'));
check('Successful history rows link reservation IDs', send.includes('reservation_id: reservationId') && schedules.includes('reservation_id: reservation?.reservationId') && reply.includes('reservation_id: reservationId') && seed.includes('reservation_id: reservationId'));
check('One active reservation per sender', sql.includes('sender_send_reservations_one_active_idx') && sql.includes('Sender is busy in another Scout job.'));
check('Rolling 24-hour and calendar-day limits exist', sql.includes("interval '24 hours'") && sql.includes("date_trunc('day'"));
check('Orphan successful sends still consume quota', sql.includes('v_orphan_sent_rolling') && sql.includes("sm.raw->>'reservation_id' = r.id::text"));
check('Reservation RPCs are service-role only', sql.includes('revoke all on function public.reserve_scout_sender_slot') && sql.includes('grant execute on function public.reserve_scout_sender_slot') && sql.includes('to service_role'));
check('Safety modes use slow randomized warm-up and normal pacing', safety.includes('60_000') && safety.includes('180_000') && safety.includes('15_000') && safety.includes('45_000'));
check('Fast mode is limited to healthy senders', safety.includes("mode === 'fast' && health === 'healthy'") && settings.includes('Fast (after healthy test)'));
check('Active sender lanes are capped in background', schedules.includes('MAX_ACTIVE_SENDER_LANES') && schedules.includes('laneAccounts.slice(index, index + MAX_ACTIVE_SENDER_LANES)'));
check('Placement test sends only one controlled message', seed.includes('Choose one sender and one test receiver.') && !seed.includes('/messages?') && seed.includes('awaiting_manual_check'));
check('Placement test does not read receiving inbox', !/users\/me\/messages\/(list|get)|gmail\/v1\/users\/me\/messages\?/.test(seed));
check('Team page is server-paginated at 20', team.includes('PAGE_SIZE = 20') && team.includes("admin_team_dashboard_page") && sql.includes('admin_team_dashboard_page'));
check('Team search supports name and email server-side', sql.includes("lower(coalesce(b.full_name, '')) like") && sql.includes("lower(coalesce(b.user_email, '')) like"));
check('Account deletion keeps anonymous duplicate fingerprints', accountDelete.includes('retained_for_duplicate_prevention') && accountDelete.includes('first_user_id: null'));
check('Account deletion requires exact DELETE', accountDelete.includes("!== 'DELETE'"));
check('Public verification pages exist', ['app/page.tsx','app/privacy/page.tsx','app/terms/page.tsx','app/data-deletion/page.tsx','app/contact/page.tsx','app/google-data-use/page.tsx'].every(exists));
check('Privacy pages include Google Limited Use statement', privacy.includes('Limited Use requirements') && dataUse.includes('Limited Use requirements'));
check('SQL migration is additive', !/\bdrop\s+(table|schema|column)\b/i.test(sql));
check('SQL includes no workspace/admin-role redesign', !/alter\s+table\s+(if\s+exists\s+)?public\.workspace_members/i.test(sql) && !/update\s+public\.workspace_members/i.test(sql));

console.log(`Scout v10.35 static validation: ${pass.length} passed`);
for (const name of pass) console.log(`  PASS  ${name}`);
if (failures.length) {
  console.error(`\n${failures.length} validation failure(s):`);
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
