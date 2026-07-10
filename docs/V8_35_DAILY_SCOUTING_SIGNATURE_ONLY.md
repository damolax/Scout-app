# Scout App v8.35 — Daily Scouting + Signature-Only Identity

## What changed

- Removed the unnecessary profile-picture input from Scout settings.
- Kept shared sender signatures.
- Signatures still append automatically to Scout-sent emails.
- Gmail signature sync remains available through the Gmail settings permission.
- Added a new **Daily Scouting** page.
- Team members can submit today's scouting history by pasting text, URLs, emails, directory output, or manual counts.
- Owner/team can see totals by person for the selected date.
- Optional import: parsed leads can be imported into Businesses.
- Direct emails can go to Ready.
- Website-only leads can be queued to Auto Scout.
- Added migration safety fix for the Supabase error: `column ms.processed_count does not exist`.

## New migration

Run this in Supabase SQL Editor:

```sql
supabase/migrations/202607100835_daily_scouting_history.sql
```

If your v8.33 notification migration already failed at `processed_count`, you can run this first:

```sql
SUPABASE_FIX_NOTIFICATION_PROCESSED_COUNT.sql
```

Then run the v8.35 migration.

## Daily Scouting workflow

1. Open `/daily-scouting`.
2. Select today's date.
3. Team member enters their name, niche, location, and source type.
4. Paste scouting history or enter manual counts.
5. Keep `Import into Businesses` on if you want those leads added to the queue.
6. Submit.
7. Owner sees totals by person.

## Important

Profile pictures are not controlled by Scout. Change Gmail/Google profile photos inside each Google account directly.
