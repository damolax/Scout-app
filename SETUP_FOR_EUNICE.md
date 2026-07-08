# Setup for Eunice / Olalekan

1. Deploy the app.
2. Run `supabase/migrations/202607050001_scout_v8_cloud.sql` in Supabase SQL Editor.
3. Open `/message`.
4. Create or select a message category.
5. Save templates inside the category.
6. Connect/select Gmail senders.
7. Send a fixed batch from Ready contacts.
8. Use Dashboard for template/sender analytics.

Scheduling note: v8.16 keeps v8.15 scheduling and stores schedules and shows due schedules. A backend worker is still needed for fully automatic sending at the exact time while the app is closed.
