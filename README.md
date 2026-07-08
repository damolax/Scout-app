# Scout App v8.20 Gmail OAuth Diagnostics

This build fixes Gmail OAuth saving/diagnostics so connected senders show in Settings.

See docs/V8_20_GMAIL_OAUTH_DIAGNOSTICS.md.

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

## v8.19 Gmail OAuth

Gmail connection is handled natively by the Node app. Add these Vercel env vars:

```txt
NEXT_PUBLIC_GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Google Cloud OAuth redirect URI:

```txt
https://scout-app-oyeola.vercel.app/api/gmail/oauth/callback
```
