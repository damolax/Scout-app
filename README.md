# Scout App v8.33

Scout App v8.33 combines timezone-aware sending, extension ingest, reply tracking, persistent notifications, and durable server-side jobs.

## v8.33 highlights

- New `/notifications` page.
- Reply sync creates persistent notification rows.
- Message page starts durable server jobs instead of relying only on a browser loop.
- Auto Scout starts through the server worker path.
- Due message/follow-up jobs continue from database schedules.
- Stale running schedules can be resumed by later worker runs.
- Exact setup and user-guide PDFs are included in `docs/`.

## Validation

- `npm install` passed.
- `npm run typecheck` passed.
- `npm run build` passed.

## Deploy

See `DEPLOY_FROM_YOUR_PC.md` and `GITBASH_REPO_COMMANDS.md`.
# Scout App v8.31 — Operations Autopilot Final Build

This build consolidates the remaining production workflow into one version instead of splitting it into several smaller releases.

## What was still remaining after v8.30

- A single place to run the full Scout loop instead of jumping between Message, Replies, No Inbox, Auto Scout, and Deliverability.
- Automatic inbox sync before follow-up sending, so real replies, auto-responders, no-inbox, bounces, blocked notices, and Gmail limit notices are detected before Scout decides who should receive another message.
- A consolidated worker endpoint that Vercel Cron can call.
- Manual worker controls from inside the app for emergency runs.
- Clear visibility into active senders, paused senders, due schedules, due follow-ups, Ready contacts, bad inboxes, and recent worker logs.
- Safer seed inbox testing, kept optional so Scout does not send unnecessary seed emails every time the full worker runs.

## Added in v8.31

- New `/operations` page.
- New `/api/workers/run-all` worker route.
- Full Autopilot run order:
  1. Sync bounces, no-inbox, and blocked-message notices.
  2. Sync real replies and auto-responders.
  3. Repair Ready/Pending email statuses.
  4. Run due initial schedules and follow-up schedules.
  5. Run Auto Scout email research worker.
  6. Optionally run seed inbox placement tests.
- Manual buttons for:
  - Full Autopilot
  - Inbox Sync Only
  - Due Sends Only
  - Auto Scout Only
- Hourly Vercel cron added for `/api/workers/run-all`.
- Worker run logs are saved into `activity_logs` as `worker_run` or `worker_warning`.
- Existing v8.30 follow-up safety locks remain active: follow-ups still re-check the due segment before sending.

## Migration

No new Supabase migration is required for v8.31.

You still need to have run all previous migrations through v8.29, especially:

```bash
cat supabase/migrations/202607090829_reply_templates_followup_segments.sql | clip.exe
```

## Required Vercel environment variables

```bash
RUN_ALL_WORKER_SECRET=change-this-long-random-secret
SCOUT_DEFAULT_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
CRON_SECRET=change-this-long-random-secret
```

`RUN_ALL_WORKER_SECRET` can reuse the same value as `CRON_SECRET`.

## Deploy

```bash
npm install
npm run typecheck
npm run build
vercel --prod
```

## After deploy

1. Open `/operations`.
2. Click **Refresh**.
3. Confirm you have active Gmail senders.
4. Run **Inbox Sync Only** first.
5. Run **Full Autopilot** after the inbox sync result looks clean.
6. Keep seed inbox testing off unless you specifically want to send test emails between connected Gmail accounts.
