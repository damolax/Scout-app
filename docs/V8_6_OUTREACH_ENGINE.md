# Scout App v8.6 Native Outreach Engine

This release moves Message from a placeholder into a native outreach control center.

## Added

- Cloud templates with subject variants and shortcode preview.
- Gmail sender account manager.
- Google OAuth connection flow through the existing backend `/gmail/exchange` route.
- Backend health check against `/gmail/status`.
- Sender profile verification through `/gmail/profile`.
- Fixed-size batch sending from Ready contacts.
- Sender rotation across selected Gmail accounts.
- Immediate sender removal when Gmail limit is detected.
- If all selected senders hit limits, remaining contacts stay Ready.
- Sent message records in Supabase.
- Outreach batch records and event logs.
- Template performance and sender performance from Supabase tracking.

## Still next

- v8.7 Replies: sync Gmail replies into Supabase, classify real replies, bounces, no-inbox, and template attribution.
- v8.8 No Inbox cleanup: bounce/no-inbox dashboards and cleanup tools.
- v8.9 Email finding/enrichment.
- v8.10 Background worker.
- v8.11 Extension directory scouting ingest improvements.
