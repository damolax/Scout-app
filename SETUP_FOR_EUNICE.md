# Setup for Eunice / Olalekan

## 1. Push the app

Unzip this package and copy the folder contents to the root of `damolax/Scout-app`.

Use `git add -A` so deleted/renamed files are staged.

## 2. Vercel settings

Make sure Vercel project settings are:

- Framework: Next.js
- Install command: blank or `npm ci --no-audit --no-fund`
- Build command: blank or `npm run build`
- Output directory: blank or `.next`

This repo also includes `vercel.json` to force the same.

## 3. Supabase

Use a new Supabase project for Scout App. Run:

`supabase/migrations/202607050001_scout_v8_cloud.sql`

Disable email confirmation for now if you want users auto-approved immediately.

## 4. First login

Create/sign in with:

`oyekunleolalekan3168@gmail.com`

This is the admin email.

## 5. Use the full feature set

Open:

`/main-scout`

This contains the full working v73 Scout features while the native pages are migrated.

## 6. Upload 100,000 contacts safely

Use `/upload` for the native cloud importer.

- Maximum: 100,000 usable rows.
- Duplicate check is chunked.
- Insert is chunked.
- Skipped duplicates can be downloaded.
- Optional checkbox queues background email research jobs after import.

## 7. Background research

Use `/auto-scout` to queue pending businesses. Vercel Cron is configured to call `/api/research/run-once` every 15 minutes.

For very large 100,000-row research jobs, the long-running worker should eventually be moved into the backend/Render server. This v8.1 package provides the cloud queue and safe progress foundation.
