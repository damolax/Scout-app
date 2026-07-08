# Scout App v8.18

v8.18 focuses on messaging readiness:

- Dedicated `/templates` page for categories and template library.
- `/message` is now only for selecting templates, senders, ready contacts, sending, schedules, and follow-ups.
- Gmail sender connection moved to `/settings`.
- Message batches can use one selected template or rotate all templates in a category.
- Message batches can use one selected Gmail sender or rotate selected Gmail senders.
- Schedules store the chosen template/sender mode and selected senders in the schedule raw metadata.
- `/email-scout` redirects to `/message`.

Run the Supabase migration after deploying if your database has not been updated through v8.15+.
