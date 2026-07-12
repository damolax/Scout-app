# Scout App v10 — Stable Simple Fast

This build focuses on reliability and speed, not new complexity.

## Main stability changes

- Send Now remains direct and immediate while Scout is open.
- Schedules no longer rely on cron.
- A global open-app runner checks due schedules while Scout is open anywhere in the app, not only on the Send Emails page.
- Live Work stays focused on current work only.
- If no contacts are found, Scout now explains why instead of only saying no ready contacts.
- Settings includes App Health Check to test leads, senders, templates, follow-ups, schedules, Auto Scout queue, signature/logo, and speed mode.

## Speed changes

- Sender last-24h counts use one grouped read instead of one query per sender.
- Background refresh polling is throttled and only runs when the tab is visible.
- Live Work polls slower when idle and faster only while work is active.
- Lists stay paginated/limited so huge uploaded lists do not freeze the UI.
- No cron/worker pages are part of the normal flow.

## Important behavior

- Send Now: runs immediately while Scout is open.
- Schedule: runs when due while Scout is open anywhere in the app, or when you click Run Due Sends Now.
- Phone reminder: use Add phone reminder for closed-app alerts.
- Auto Scout: runs when started from the app.
