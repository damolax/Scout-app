# Scout App v9.4 — No Cron / Open-App Runner

This build removes cron from the normal user flow.

## What changed

- Send Now stays direct and immediate from the browser page.
- Saved schedules no longer tell the user to rely on cron.
- Send Emails now has an open-app schedule runner.
- When Scout is open on the Send Emails page, due schedules are checked every 15 seconds.
- Each due schedule sends a small safe chunk, then the open app continues the next chunk on the next check.
- Run Due Sends Now still lets the user manually start due schedules.
- Auto Scout language was simplified: no more background/cron worker wording in the user interface.
- Live Work remains for currently happening work.

## Important behavior

Schedules run when Scout is open. If the app/browser/phone is fully closed or sleeping, schedules are intentionally not expected to run. This matches the requested no-cron setup.

## No SQL required

This version uses the existing v9.x schema.
