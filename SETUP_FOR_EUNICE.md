# Setup for Scout App v8.31

This version is designed so you do not need many more small versions. The next production loop is now in one place: `/operations`.

## 1. Deploy

```bash
npm install
npm run typecheck
npm run build
vercel --prod
```

## 2. Add/confirm Vercel env variables

Keep all existing Supabase and Gmail variables, then add:

```bash
RUN_ALL_WORKER_SECRET=use-a-long-random-secret
CRON_SECRET=use-the-same-long-random-secret
SCOUT_DEFAULT_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
```

## 3. Use the new Operations page

Go to:

```text
/operations
```

Use this order the first time:

1. Click **Inbox Sync Only**.
2. Check Replies / No Inbox / Deliverability.
3. Click **Due Sends Only** if you have scheduled messages.
4. Click **Auto Scout Only** if you want to keep researching missing emails.
5. Click **Full Autopilot** once everything looks correct.

## 4. What Full Autopilot does

It runs this order:

1. Bounces, no-inbox, and blocked notices.
2. Real replies and auto-replies.
3. Ready/Pending repair.
4. Due schedules and due follow-ups.
5. Auto Scout research worker.
6. Optional seed inbox test if you tick it.

Seed testing is off by default because it sends real test emails between your connected Gmail accounts.

## 5. Cron

`vercel.json` now includes:

```json
{
  "path": "/api/workers/run-all?workspaceId=00000000-0000-4000-8000-000000000001&includeSeedTest=false",
  "schedule": "0 * * * *"
}
```

That means the production app can run the safe loop every hour.
