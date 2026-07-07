# Scout App v8.1 Feature Parity Checklist

This file exists so Scout App v8 does not silently lose features from the working v73 line.

## Kept immediately through Main Scout App

The full working v73 HTML is mounted inside the Next/Supabase shell at `/main-scout` and served at `/api/main-scout`. This preserves the old interface while native cloud pages are migrated one by one.

### Preserved v73 feature areas

- Dashboard and single-dashboard hard-fix behavior
- Upload List tab
- CSV import/preview/import count flow
- Business queue and business detail panel
- Queue filters including ready/email/no-email/team-scouted/web leads
- Google/Bing dorking controls
- Directory/browser extension scouting flow
- Extension sync bridge
- OAuth/Gmail connection settings
- Multiple Gmail account storage/selection
- Backend URL/settings
- Auto Scout controls
- Backend email finding/enrichment calls
- Verify tab and ready-to-send preparation
- Email Scout / Send Message tab
- Message templates
- Separate subject lines and message bodies
- Signature and sender name settings
- Batch approval/review flow
- Batch sending
- Send delay controls
- Live send log/activity log
- Sender tracking: which Gmail sent which message
- Reply polling/checking
- Reply history inside Scout
- Tracking which Gmail received the reply
- Real reply classification
- Fake reply/bounce/mailer-daemon exclusion logic
- No Inbox / bounced handling
- Contacted status logic
- Local team-scouted dedupe registry
- Timeline/activity log
- Export/import backup
- Settings save/sync controls

## Added in v8.1 cloud shell

- Email/password login via Supabase
- Admin email default: `oyekunleolalekan3168@gmail.com`
- Auto-approved users into default workspace
- Native cloud dashboard
- Native cloud business queue table
- Native upload page with 100,000-row limit
- Safe duplicate checking in small chunks
- Chunked Supabase inserts
- No massive Supabase `.in(...)` URL for 5,000+ rows
- Download skipped duplicates
- Cloud `email_research_jobs` table
- `/api/research/enqueue` to queue pending businesses
- `/api/research/run-once` to process a small backend research cycle
- Vercel cron hook every 15 minutes for the research runner

## Not yet considered complete until tested

- Native cloud rewrite of Gmail OAuth
- Native cloud rewrite of batch sending
- Native cloud rewrite of reply checking
- Native cloud rewrite of no-inbox/bounce cleanup
- Native cloud rewrite of dorking UI
- Direct extension push into authenticated workspace

Until each native rewrite is tested, use **Main Scout App** for the full proven feature set.
