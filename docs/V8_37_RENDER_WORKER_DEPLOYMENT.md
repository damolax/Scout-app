# Scout App v8.37 — Render Worker Deployment

This version keeps Vercel as the app host and uses Render as the background worker so Scout keeps working even when every user closes the browser.

## What continues after users leave the page

The Render worker calls `/api/workers/run-all` repeatedly. That endpoint processes:

- Gmail reply sync
- Gmail bounce / no-inbox / blocked sync
- Ready/Pending repair
- scheduled first messages
- scheduled follow-ups
- Auto Scout email research jobs
- persistent notifications

Users can start a message job or Auto Scout job and leave the page. The job record remains in Supabase. The Render worker keeps picking up due work.

## Required environment variables on Render

Set these in the Render worker service:

```env
SCOUT_APP_URL=https://your-scout-app.vercel.app
SCOUT_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
RUN_ALL_WORKER_SECRET=use-the-same-secret-as-vercel
WORKER_INTERVAL_MINUTES=15
```

Optional tuning:

```env
WORKER_REPLY_DAYS=90
WORKER_REPLY_LIMIT=500
WORKER_SCHEDULE_LIMIT=3
WORKER_AUTO_SCOUT_CYCLES=5
WORKER_AUTO_SCOUT_BATCH_SIZE=100
WORKER_AUTO_SCOUT_CONCURRENCY=12
WORKER_AUTO_SCOUT_ENQUEUE_LIMIT=2500
```

## Required environment variable on Vercel

Set the same secret in Vercel:

```env
RUN_ALL_WORKER_SECRET=use-the-same-secret-as-render
```

The worker passes this secret in the request headers so the endpoint can run without a logged-in browser user.

## Render Background Worker command

Use this start command:

```bash
node scripts/render-worker.mjs
```

The script loops forever and waits `WORKER_INTERVAL_MINUTES` between runs.

## Render Cron Job alternative

If you prefer Render Cron Job instead of a persistent worker, set:

```env
RUN_ONCE=true
```

Then run the same command:

```bash
node scripts/render-worker.mjs
```

Cron will run one cycle and exit.

## Why Vercel cron was removed

Vercel Hobby rejected the previous hourly cron. v8.37 removes Vercel cron from `vercel.json`. Render now controls background automation.
