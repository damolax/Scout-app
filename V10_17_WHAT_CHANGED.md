# Scout v10.17 — Multilingual Real Reply Classifier

This version improves the reply classifier so German auto acknowledgements are not counted as real replies just because they are written in German or have a Re/AW subject.

## Changed
- Added stronger German auto-reply detection.
- Added more French, Spanish, Italian, and Dutch auto-reply detection.
- Added human-intent terms in German and other languages so real negative replies and requests for more details still count.
- Dashboard continues to show Real Replies only.
- Challenges and Scouting Level continue to use the same real-reply count.
- Added SQL cleanup file: `SUPABASE_V10_17_MULTILINGUAL_REAL_REPLIES.sql`.

## Important
Scout does not need to show auto replies on the dashboard. Auto replies remain saved in Replies for review, but dashboard and challenges use real replies only.
