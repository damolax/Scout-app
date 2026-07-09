# Scout App v8.26 — Scheduled Worker + Seed Inbox Solid Fix

This build solidifies the scheduled sender worker and fixes the Settings seed inbox confusion.

## What changed

- Removed the visible Google Cloud redirect URI/env-var setup notices from Settings.
- Seed receiver checkbox now auto-saves immediately.
- Running a seed test now saves all sender/seed settings first.
- Seed test route accepts connected/ready Gmail accounts and waits briefly before checking placement.
- Scheduled sender worker is the v8.26 focus.
- Scheduled worker accepts Vercel cron bearer auth if CRON_SECRET/SCHEDULE_WORKER_SECRET is used.
- Message schedule UI text now describes v8.26 behavior.

## Test status

- `npm run typecheck` passed.
- `npm run build` passed.

## Supabase migration

Run:

```bash
cat supabase/migrations/202607090826_scheduled_worker_seed_solid.sql | clip.exe
```

Paste it into Supabase SQL Editor and run it.
