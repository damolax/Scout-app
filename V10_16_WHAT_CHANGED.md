# Scout v10.16 — Real Replies Only Dashboard

This build changes the reply system back to a stricter real-reply view.

## Main changes

- Dashboard shows **Real Replies**, not auto replies.
- The dashboard analytics filter now applies to real replies:
  - Today = real replies today
  - Last 7 days = real replies in the last 7 days
  - Last 30 days = real replies in the last 30 days
  - All time = all real replies
- Auto messages are removed from dashboard reply counts.
- Auto messages are still saved in Replies so the user can inspect them if needed.
- Bounces, no-inbox, blocked messages, Gmail limit notices, ticket receipts, feedback surveys, out-of-office messages, and “we received your message” style receipts do not count as Real Replies.
- Real negative replies still count. Examples:
  - “We do not need this.”
  - “Not interested.”
  - “Send more details.”
  - “Who are you?”
  - “Your email is unprofessional.”
- Replies page labels are clearer:
  - Real Replies
  - Auto Messages
- Challenges and Scouting Level use the same real-reply metric.

## Required SQL

Run:

```text
SUPABASE_V10_16_REAL_REPLIES_ONLY.sql
```

Then open Scout and run:

```text
Replies → Sync replies + bounces
```
