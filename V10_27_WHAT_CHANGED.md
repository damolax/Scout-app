# Scout v10.27 — Fast Load + Template Save Repair

This version fixes the slow loading and template save errors reported after v10.26.

## What changed

- App-open reply sync is now a tiny new-message pulse, not a heavy background sync.
- The app no longer tries to run reply sync, schedule checks, notification polling, live work polling, and level checks all at the same time on page load.
- Notification bell now uses one lightweight query instead of two parallel Supabase queries.
- Notification bell polling is slower and does not overlap with itself.
- Live Work loads after the app settles and polls less aggressively when closed.
- Scouting Level loads after the app settles and refreshes less often.
- Automatic reply sync checks fewer accounts/messages per pulse and quietly retries later if Supabase is temporarily busy.
- `PGRST003` pool timeout during app-open quick sync is treated as retry-later, not a broken Scout alert.
- Template saving now handles older databases better.
- If `templates.raw` is missing, Scout will not block saving the template anymore.
- SQL adds `templates.raw`, template support columns, and safe indexes.

## Important behavior

Scout still checks for new replies when the app opens or when you return to the app. It now does it safely in small pulses so the app can load first.

Manual full sync on Replies page is still available for deeper checking.

Run `SUPABASE_V10_27_FAST_LOAD_INDEXES.sql` once after deployment.
