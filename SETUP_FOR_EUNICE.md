# Scout App v8.3 Native Shell Setup

This version removes translation for now and keeps the app focused on the native Node/Next/Supabase foundation.

## 1. Supabase

Use the Scout App Supabase project. Run:

```text
supabase/migrations/202607050001_scout_v8_cloud.sql
```

## 2. Vercel env vars

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
NEXT_PUBLIC_BACKEND_URL=https://scout-email-finder.onrender.com
NEXT_PUBLIC_ADMIN_EMAIL=oyekunleolalekan3168@gmail.com
RESEARCH_CRON_SECRET=change-this
```

## 3. Test order

1. Login.
2. Open Dashboard.
3. Open Settings.
4. Save backend URL.
5. Save a simple email template.
6. Open Upload and test a small CSV.

## Removed for now

- `/translate` page.
- `/api/translate`.
- DeepL/LibreTranslate env vars.
- Template translate buttons.


## v8.3 Native Import

- CSV import limit: 100,000 usable rows per file.
- Duplicate checks use `check_existing_normalized_keys` RPC over POST chunks, not a giant URL query.
- Inserts run in 500-row chunks.
- Invalid rows and skipped duplicates can be downloaded.
- If unfinished queue records exist and a new CSV has very different columns, Scout shows a campaign-mixing warning.

Run the Supabase migration again before testing import.
