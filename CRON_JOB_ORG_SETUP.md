# Scout cron-job.org setup

Use this when you do not have a paid Render Background Worker or Vercel Pro Cron.

## Cron URL

Replace `YOUR_SECRET` with the same value stored in Vercel as `RUN_ALL_WORKER_SECRET`.

```text
https://scout-app-oyeola.vercel.app/api/workers/run-all?workspaceId=00000000-0000-4000-8000-000000000001&includeSeedTest=false&token=YOUR_SECRET
```

## cron-job.org settings

- Method: GET
- Schedule: every 15 minutes
- Timeout: 60 seconds if available
- Save execution history: yes

## What it does

This wakes Scout and runs due work: scheduled sends, follow-ups, reply sync, bounce/no-inbox checks, notifications, and Auto Scout queue processing.

## Manual test

```bash
curl "https://scout-app-oyeola.vercel.app/api/workers/run-all?workspaceId=00000000-0000-4000-8000-000000000001&includeSeedTest=false&token=YOUR_SECRET"
```
