# Scout App v8.1 Full Workspace

Scout App v8.1 keeps the Node/Next/Supabase application and mounts the full working Scout App v73 feature set inside it as **Main Scout App**.

## What this package is for

- Keep login/cloud workspace structure.
- Keep the full old Scout feature set available immediately.
- Add a safer native 100,000-row import path.
- Add a cloud background email research queue foundation.
- Avoid the giant one-file app becoming the only future path.

## Important routes

- `/login` — email/password login.
- `/main-scout` — full working Scout feature set mounted inside v8.
- `/upload` — native cloud import with safe chunks and 100,000-row limit.
- `/auto-scout` — queue background email research jobs.
- `/api/research/enqueue` — enqueue pending businesses for research.
- `/api/research/run-once` — process a small batch of queued research jobs.

## Feature parity

See `docs/SCOUT_FEATURE_PARITY.md` before removing or replacing any old feature.

## Deployment

Use Vercel as a Next.js app. `vercel.json` is included and sets:

- install: `npm ci --no-audit --no-fund`
- build: `npm run build`
- output: `.next`

## Environment variables

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_BACKEND_URL=https://scout-email-finder.onrender.com
NEXT_PUBLIC_ADMIN_EMAIL=oyekunleolalekan3168@gmail.com
CRON_SECRET=optional-secret-for-manual-cron-calls
```

## Supabase SQL

Run:

`supabase/migrations/202607050001_scout_v8_cloud.sql`

This migration now includes `email_research_jobs`.
