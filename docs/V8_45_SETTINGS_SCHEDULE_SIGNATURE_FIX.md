# Scout v8.45 — Settings, Schedule, Signature Fix

- Adds the missing `message_schedules.run_kind` SQL repair.
- Adds a visible signature logo URL field and preview in Settings.
- Sync-to-Gmail now includes the logo URL in the generated Gmail signature HTML.
- Settings sender table now shows only sent count in the last 24 hours, not `sent / limit`.
- Sender type uses `Other` instead of `Custom` to match the database constraint.

Run `SUPABASE_V8_45_SETTINGS_SCHEDULE_SIGNATURE.sql` after deployment.
