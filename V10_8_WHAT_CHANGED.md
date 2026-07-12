# Scout App v10.8 — Better Challenges + Real Reply Cleanup

## What changed

- Challenges are now much harder and more meaningful.
- Added 10,000,000 delivered messages as a Legend challenge.
- Added one-day send milestones: 5,000, 10,000, 20,000, 35,000, 50,000, 75,000, and 100,000.
- Added one-day real reply milestones: 10, 20, 30, 50, and 100.
- Removed auto-reply challenges completely.
- Added bigger stretch goals for trusted emails, Auto Scout checks, Gmail accounts, templates, due follow-ups, and replies sent from Scout.
- Dashboard checklist still includes “Respond to a prospect from Scout.”
- Reply classification is stricter: ticket confirmations, received-message notices, feedback requests, out-of-office messages, and multilingual auto acknowledgements are no longer counted as real replies.
- Replies page also filters obvious auto replies out of the Real Replies list even if old rows were classified incorrectly.
- Added Supabase cleanup SQL to reclassify old auto replies that were counted as real replies.

## SQL

Run:

```text
SUPABASE_V10_8_RECLASSIFY_AUTO_REPLIES.sql
```

This updates old reply rows so Dashboard and Challenges stop counting auto replies as real replies.
