# Scout v8.41 — Outreach Repair

This release focuses on reliability instead of adding new tabs.

## Fixed
- Message schedules no longer fail when `last_error` or progress columns are missing after running the v8.41 Supabase SQL.
- Follow-up RPC is repaired with `public.get_due_followups` returning the columns used by Message/Operations.
- Sending jobs remain visible on the Outreach page after refresh.
- Running/scheduled jobs have a Stop button.
- Signature saving has a raw fallback so Scout-local signatures can still save even before all columns exist.
- Scheduled worker respects per-run caps, daily sender limits, and durable progress counters.

## Button meanings
- Start Initial Batch: starts a durable sending job now.
- Save Schedule: saves a future job; automation/cron runs it when due.
- Run Due Schedules Now: manually triggers due scheduled jobs immediately.
- Stop: requests the worker to stop after the current in-flight recipient finishes.

## Required SQL
Run `SUPABASE_V8_41_REPAIR.sql` in Supabase SQL Editor.
