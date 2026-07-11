# Scout v8.49 — Reliable Schedule + PWA Notifications + Country Filter

## What changed

- Added a lightweight cron endpoint: `/api/workers/run-due`.
- Do not use heavy `/api/workers/run-all` for cron.
- Schedule jobs now run in small chunks and remain scheduled until the target count is reached.
- Live Work stays small and closed by default, but can request desktop notifications.
- Added PWA install support with a manifest and service worker.
- Added Country / market filter to Send Emails for immediate sends and schedules.

## Cron URL

Use this with cron-job.org every 5 or 10 minutes:

```text
https://scout-app-oyeola.vercel.app/api/workers/run-due?workspaceId=00000000-0000-4000-8000-000000000001&limit=1&targetLimit=25&senderRunLimit=25&token=YOUR_REAL_SECRET
```

## Important

Send Now still sends directly from the browser while the page is open. Schedule/background sending needs the lightweight cron URL or a real server worker.
