# Scout v8.33 - Notifications + Durable Jobs

## What changed

v8.33 adds the missing production layer:

- Replies synced from Gmail now create persistent app notifications.
- Notifications are stored in `app_notifications`, not only shown as a popup.
- New `/notifications` page lists real replies, auto replies, no-inbox, blocked messages, bounces, Gmail limits, and worker signals.
- Message sending from the Message page is now started as a durable server-side job through `/api/message/start-job`.
- Leaving the Message page no longer kills a started send job.
- Auto Scout start now uses the server worker queue instead of depending on a browser loop.
- Due jobs are picked up by `/api/message/run-schedules` and the hourly `/api/workers/run-all` cron.
- Running message jobs update progress counters and heartbeat fields.
- Stale running schedules are reset so the worker can resume after timeout or page close.

## Reply tracking answer

Yes, replies can be auto-input to the app when Gmail sync runs. The system reads Gmail inbox messages, matches them to sent messages by Gmail thread ID or recipient email, then writes:

- `reply_history` for real replies and auto replies
- `no_inbox_records` for bounces/no-inbox/blocked notices
- `businesses.status = responded` for real replies
- `sent_messages.delivery_status = replied`, `auto_replied`, `no_inbox`, etc.
- `app_notifications` for persistent user-visible alerts

Gmail does not normally give a perfect inbox-delivered receipt. Scout tracks a send as accepted by Gmail first, then later changes the status if a bounce, blocked notice, auto reply, or real reply is detected.

## Durable job answer

Started jobs are no longer only browser loops:

- Message page sends are saved into `message_schedules` immediately.
- The worker sends from the database schedule.
- The schedule keeps progress counts.
- If the page closes, the schedule still exists.
- If a worker times out, a later worker run can resume the schedule.
- Auto Scout jobs already live in `email_research_jobs`; v8.33 makes the main button use the server worker path.
