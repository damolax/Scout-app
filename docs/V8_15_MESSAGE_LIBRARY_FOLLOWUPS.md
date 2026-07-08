# v8.15 Message Library + Follow-ups

## Added

- Message library categories.
- Multiple templates per category.
- Shortcode note directly in the library.
- Category-based template rotation.
- Business category filter for sending.
- Fixed batch size is user controlled up to the safety cap.
- Scheduled initial batches.
- 72-hour follow-up due list.
- Schedule due follow-ups.
- Send due follow-ups now.
- Message analytics moved to Dashboard.
- Email Scout route redirects to Message.

## Shortcodes

{name}, {business}, {company}, {email}, {website}, {domain}, {phone}, {category}, {industry}, {location}, {source}

## Important

Automatic background schedule execution still needs a backend worker/cron. v8.15 stores schedules and allows due schedules to be sent from the app.
