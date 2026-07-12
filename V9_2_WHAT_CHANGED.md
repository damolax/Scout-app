# Scout App v9.2 — Ready contacts, location scan, due follow-ups

## Fixed

- Send page no longer only depends on `businesses.status = ready`.
- Contactable leads now include uploaded/contactable statuses with emails: `ready`, `found`, and `connected`.
- Location dropdown is built from available uploaded lead fields, not just `businesses.location`.
- Location extraction checks `location`, `country`, `country_name`, `market`, `city`, `region`, `state`, `province`, `address`, `territory`, and matching keys inside the raw uploaded CSV data.
- Send Now applies the same uploaded-location matching.
- Saved schedules pass the same uploaded-location filter to the worker.
- Cron/schedule worker applies the same multi-field location matching before sending.
- Follow-up panel is renamed to “Due Follow-ups — 72h no real response” and shows the current due count more clearly.

## Follow-up behavior

Due follow-ups come from the Supabase RPC `get_due_followups`. It selects contacts whose last first email is older than 72 hours and excludes real replies, bounces, blocks, and no-inbox records.

## SQL

No new SQL is required if your previous v9.1 SQL and `get_due_followups` function already exist.
