# Scout v9.5 — No-Cron Reminder Notifier

This build keeps the no-cron workflow and adds reminders for schedules.

## Added
- Enable app notifier for schedule-due alerts while Scout/PWA is open or active.
- Add phone/calendar reminder button for saved schedules.
- Due schedule banner on Send Emails.
- Last saved schedule reminder shortcut.
- Reminder reset button per scheduled job.

## Removed from normal package
- Cron setup docs.
- Public `/api/workers/run-all` and `/api/workers/run-due` routes.
- Operations page route.

## Important behavior
- Send Now sends directly while the app page is open.
- Schedule sends only when Scout is open on Send Emails or when Run Due Sends Now is clicked.
- Phone notifications while Scout is fully closed are handled by calendar reminders, not hidden cron.
- Auto Scout is still app-run: click Start Auto Scout Now and keep the page open while it works.
