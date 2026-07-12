# Scout App v9.3 — Auto Scout Restore

This build restores Auto Scout to doing visible, immediate work again.

## Fixed

- **Start Auto Scout Now** no longer depends only on the server worker path.
- It queues no-email leads first, then runs live batches from the page so you can see real progress.
- Auto Scout endpoints now allow a signed-in approved workspace member to run them even when cron/worker secrets are configured.
- This fixes the issue where Auto Scout silently did nothing or returned unauthorized after cron/worker secrets were added.
- Queueing now scans **all no-email leads with usable research input**, not only `pending`, `review`, and `found` statuses.
- This prevents uploaded leads with statuses like `ready`, `new`, `imported`, or `connected` from being skipped.
- Stale `running` Auto Scout jobs are automatically reset before processing.

## Still available

- `Run Server Worker` is still there for background/server processing.
- `Run One Backend Batch` is still there for manual testing.
- Live Work still shows current Auto Scout activity.

## No SQL required

This build is code-only. Existing Auto Scout tables are used.
