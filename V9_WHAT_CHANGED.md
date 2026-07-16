# Scout App v9 — Live Current Work

This version changes the small Live Work window so it is for what is happening **right now**, not old sent-history.

## Changes

- Live Work remains closed by default.
- Click the Live Work pill to open it; click again to close it.
- Send Now emits live client-side updates immediately:
  - Send started
  - Sending message to email
  - Message sent
  - Send failed / blocked / sender limit
  - Send finished
- Scheduled/cron sending writes live `outreach_events` before and after each email, so the Live Work window can show current server-side progress.
- Auto Scout writes live `activity_logs` while checking businesses, doing deeper website checks, finding emails, or failing.
- The Live Work window hides old sent-email history. Old messages are no longer displayed as if they are live work.
- The activity API only returns fresh live events and active jobs.

## No new SQL is required

This version uses existing tables:

- `outreach_events`
- `activity_logs`
- `message_schedules`
- `email_research_jobs`
- `sent_messages`
