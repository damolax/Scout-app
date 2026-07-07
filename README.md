# Scout App v8.2 Native Shell

This package keeps Scout App as a real Node/Next/Supabase application. It removes the embedded legacy/Main Scout approach and keeps the app ready for feature-by-feature native migration.

## Included

- Supabase email/password login.
- Admin email support via `NEXT_PUBLIC_ADMIN_EMAIL`.
- Native protected pages for dashboard, upload, businesses, verify, auto scout, email scout, replies, no inbox, data safety, and settings.
- Settings page for backend URL, extension API key, and email templates.
- 100,000-row import foundation for the next deliverable.
- Background research queue foundation.
- No translation feature in this build.

## Required env vars

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_BACKEND_URL=https://scout-email-finder.onrender.com
NEXT_PUBLIC_ADMIN_EMAIL=oyekunleolalekan3168@gmail.com
RESEARCH_CRON_SECRET=change-this
```

## Deploy

Run the SQL migration in `supabase/migrations/202607050001_scout_v8_cloud.sql`, set the env vars in Vercel, then deploy.

## Next deliverable

`v8.3 native import` — complete 100,000-contact upload, chunked import, duplicate skipping, invalid row export, and import batch history.
