# Scout App v10.19 — Auto Scout Server Runner + Matching Missing Email Count

- Auto Scout Start now uses the safer server runner instead of looping many browser-side batches.
- The page keeps only one setting: how many leads to queue.
- Hidden settings stay locked to safe values: batch 20, speed 4, rounds 3.
- If NEXT_PUBLIC_BACKEND_URL is set, email finding still uses the Render email-finder backend.
- The browser no longer tries to orchestrate every batch itself, reducing page crashes.
- Dashboard Needs Email and Find Missing Emails Missing emails now use the same counting rule.
- “Missing emails” means leads with no usable email yet that are not already contacted, responded, blocked, bounced, archived, or deleted.
