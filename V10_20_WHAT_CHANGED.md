# Scout App v10.20 — Auto Scout Queue Clarity

This build fixes the Auto Scout page so it is easier to understand and safer to run.

## What changed

- Removed the confusing “Waiting” label.
- Added one clear label: **In Queue**.
- **Need Emails** now means the same thing as the Dashboard: leads with no usable email that are not currently in queue/checking.
- Auto Scout now has a clear flow:
  1. Add leads to queue.
  2. Start checking queue.
  3. View results on the same page.
- Added **Return queue to Need Emails** so leftover queued leads can be cleared instead of pretending the run completed.
- Start checking queue now uses the safe server runner in small groups.
- The page shows whether the Render email finder backend is configured.
- Checking Now explains when nothing is being checked.
- Results and recent checks are visible on the same page.
- Added `/api/research/return-queue`.

## Notes

Auto Scout still uses `NEXT_PUBLIC_BACKEND_URL` if it is set. If it is set to your Render URL, the email-finder backend is still Render-backed.
