# Scout v10.15 — One Reply Count + Cleaner Dashboard

What changed:

- Scout now uses one reply count everywhere.
- Dashboard, Replies, Challenges, Scouting Level, and reports count replies the same way.
- A reply means any inbound message that is not a bounce, no-inbox, blocked notice, or Gmail limit notice.
- The app no longer tries to hide auto-looking replies from the main count, so useful prospect messages are not lost.
- Dashboard was reduced to 12 main cards.
- Dashboard no longer repeats Replies in multiple cards.
- Removed Responded Businesses from the main dashboard cards to avoid confusion.
- Replies page wording is simpler.
- Added a global loading screen so pages show feedback immediately while data loads.

Run `SUPABASE_V10_15_ONE_REPLY_COUNT.sql` after deployment.
