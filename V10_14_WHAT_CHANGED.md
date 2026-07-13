# Scout v10.14 — Unified Counts + Fast Replies

- Dashboard, Replies, Challenges, Scouting Level, and the daily report now use the same real-reply calculation.
- Dashboard no longer mixes Responded businesses with Real replies without explaining the difference.
- Replies page loads faster because it gets official totals from a small metrics endpoint and only loads recent rows for display.
- Replies page now says how many recent rows are shown versus the official total.
- Added Supabase cleanup SQL to reclassify old ticket confirmations/auto replies and recover obvious human replies.
