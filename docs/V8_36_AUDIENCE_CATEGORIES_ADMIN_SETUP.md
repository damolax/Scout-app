# Scout App v8.36 — Audience Categories + Admin Setup

## What changed

- Added audience categories to CSV upload, Source Scout, Auto Source Scout, Daily Scouting, extension ingest, and message sending.
- The same category can group both the audience and the matching templates, for example `Airtable service`, `Marketing`, or `Shopify audit`.
- Message sending can filter ready contacts by audience category, then use/rotate templates from the chosen template category.
- Daily Scouting submissions now store category names, so the owner can see not only who scouted but what audience/category they scouted.
- Extension dorking can save an audience category and send that category into Scout automatically.
- Admin Settings now saves Scout App URL, optional Render/backend URL, extension ingest URL, workspace key, and default audience category.

## Supabase migration

Run:

```sql
supabase/migrations/202607100836_audience_categories_admin_setup.sql
```

Run this after v8.33, v8.34, and v8.35 migrations if those have not been run yet.

## Notes

- Profile pictures are not managed inside Scout. Gmail profile photos should be set in each Google account directly.
- Signatures remain managed in Scout and can sync to Gmail when the Gmail settings scope is approved.
- Google automated dorking can be blocked by Google; the extension is the safer way to capture Google pages because it works in the browser session.
