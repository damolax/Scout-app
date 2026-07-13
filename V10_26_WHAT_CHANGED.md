# Scout App v10.26 — New-Only Reply Sync + Template Versioning

## Reply sync
- App-open / refresh / return-to-app sync is now a light new-only check.
- Scout first lists recent Gmail message ids and skips messages already saved in `reply_history`.
- Old synced replies are not reprocessed and do not create repeated bell notifications.
- The quick check uses small Gmail batches and a deadline so it does not trigger long HTTP 504 waits.
- Manual full sync remains available on the Replies page.
- Scout bell notifications are created only for newly inserted important inbound signals: real replies, no-inbox/bounce/blocked, and Gmail limit notices.

## Templates
- Saving templates no longer sends `attachments` as a top-level database column, so older Supabase tables without `templates.attachments` no longer fail with PGRST204.
- Template files are saved in `raw.attachments`, which the sender already reads.
- Updating a template now archives the old template and creates a fresh template id.
- The updated version starts with zero performance until used.
- Old/deleted/archived templates are hidden from Dashboard Template Performance.

## Dashboard performance
- Template Performance now shows active templates only.
- Old template versions and archived templates no longer appear.
