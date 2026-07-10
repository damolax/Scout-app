# v8.30 — Follow-up Safety Locks

## Added

- Initial sends now use **initial templates only**.
- Follow-up sends now use **follow-up templates only**.
- Reply-only templates remain available only inside the business conversation reply panel.
- Direct **Send Segment Now** re-checks the selected follow-up segment before sending.
- Scheduled follow-ups re-check `get_due_followups` at worker run time, even when the schedule was created from a fixed due-business list.
- If a business gets a real reply, no-inbox record, bounce, or blocked-delivery event after the schedule was created, Scout suppresses that business before the follow-up sends.
- Manual/client-side sent rows now save `is_follow_up` so follow-up reporting and future filtering are more reliable.
- Gmail accounts with status `ready` are treated as usable senders, matching the API routes.

## Why

v8.29 introduced reply templates and follow-up segments. v8.30 makes the system safer in real use: a follow-up should never accidentally use a first-message template, and a scheduled follow-up should not fire after the prospect has already replied or after Scout has detected a bad inbox.

## Migration

No new SQL migration is required for v8.30. Make sure the v8.29 migration has already been run because v8.30 relies on the v8.29 columns/functions:

- `templates.template_type`
- `message_schedules.followup_segment`
- `sent_messages.is_follow_up`
- `reply_history.reply_bucket`
- `businesses.reply_state`
- `public.get_due_followups(...)`
