# Scout v8.48 — Restore Send Now

This build restores the previous proven Send Now behavior.

## Important change

Send Now no longer depends on cron or the message_schedules worker. It sends immediately from the Message page using the same direct Gmail send loop that was working before.

You will see live text on the Message page like:

- Sending now 1 / 500 · sender@example.com → prospect@example.com
- Message sent 1 / 500 · sender@example.com → prospect@example.com

## What still needs cron/background worker

If the app is fully closed and no browser tab is running, only a server-side worker/cron can continue future scheduled jobs. A closed browser cannot keep JavaScript running.

Schedules still use message_schedules. The schedule runner now allows either a valid worker token or a signed-in app session, so the in-app "Run due schedules now" button can work without exposing the cron token in the browser.

## SQL

Run SUPABASE_V8_48_SEND_NOW_SCHEDULE_FIX.sql if schedule columns are missing.
