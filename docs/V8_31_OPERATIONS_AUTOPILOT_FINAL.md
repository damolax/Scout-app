# v8.31 — Operations Autopilot Final Build

## Goal

Collapse the remaining Scout versions into one production-control build.

## Added

- `/operations` page.
- `/api/workers/run-all` endpoint.
- Hourly Vercel cron for the consolidated worker.
- Manual worker controls:
  - Full Autopilot
  - Inbox Sync Only
  - Due Sends Only
  - Auto Scout Only
- Worker result table showing each step and metrics.
- Recent worker logs from `activity_logs`.

## Worker order

1. Sync bounces, no-inbox, and blocked notices across all connected/ready Gmail accounts.
2. Sync real replies and auto-responders across all connected/ready Gmail accounts.
3. Repair Ready/Pending contact statuses.
4. Run due message schedules and follow-up schedules.
5. Run Auto Scout server worker.
6. Optionally run seed inbox placement tests.

## Safety choices

- Seed inbox test is not included by default because it sends real test emails.
- The worker logs partial failures instead of hiding them.
- Follow-up safety from v8.30 still applies. Due follow-ups are re-read at execution time before sending.
- Manual UI calls are authorized by the logged-in workspace member. Cron/secret calls use `RUN_ALL_WORKER_SECRET` or `CRON_SECRET`.

## No new database migration

This build uses existing tables:

- `gmail_accounts`
- `reply_history`
- `no_inbox_records`
- `message_schedules`
- `sent_messages`
- `email_research_jobs`
- `activity_logs`
