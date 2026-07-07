# Scout App Native Feature Parity Plan

Goal: rebuild Scout App as real Node/Next/Supabase pages. No embedded legacy HTML, no iframe app, no `/main-scout` shortcut.

## v8.2 Native Shell — Done in this package

- [x] Supabase email/password login
- [x] Admin email configuration
- [x] Auto-approved workspace membership
- [x] Protected app shell/sidebar
- [x] Native pages only
- [x] Remove `/main-scout`
- [x] Remove `/classic`
- [x] Remove `legacy/scout-classic.html`
- [x] English/German/French/Spanish support

## v8.3 Native Import — Next

- [ ] CSV/XLSX upload
- [ ] 100,000 usable row limit
- [ ] Chunked parsing
- [ ] Chunked duplicate check
- [ ] Chunked insert
- [ ] Different-target-list warning
- [ ] Download skipped duplicates
- [ ] Download invalid rows
- [ ] Import batch history

## v8.4 Business Queue

- [ ] Pending queue
- [ ] Search/filter/status tabs
- [ ] Business detail page
- [ ] Bulk actions
- [ ] Export queue
- [ ] Phone-friendly queue view

## v8.5 Team Dedupe

- [ ] Team scouted registry
- [ ] Import old local v7 scouted history
- [ ] Prevent repeated scouting across users
- [ ] Show why a row was skipped

## v8.6 Templates

- [ ] Full template manager
- [ ] Templates
- [ ] Subject variants
- [ ] Placeholder validation

## v8.7 Gmail OAuth

- [ ] Native Gmail connection UI
- [ ] Multiple accounts
- [ ] Sender health
- [ ] Backend OAuth test

## v8.8 Batch Sending

- [ ] Ready-to-send queue
- [ ] Batch sending
- [ ] Sender selection/rotation
- [ ] Per-message send log
- [ ] Mark contacted after backend confirms send

## v8.9 Replies

- [ ] Read replies from backend/Gmail
- [ ] Know which Gmail received reply
- [ ] Match reply to business/contact

## v8.10 No Inbox / Bounces

- [ ] Mailer daemon detection
- [ ] Delivery failure detection
- [ ] Move to No Inbox
- [ ] Exclude from real replies

## v8.11 Verify / Email Finder

- [ ] Find emails from websites
- [ ] Verify/scoring
- [ ] Role email/free-provider/business-domain detection

## v8.12 Background Research

- [ ] Backend worker queue
- [ ] Research continues when user is not on app
- [ ] Progress visible from phone/PC

## v8.13 Extension Flow

- [ ] Extension CSV import
- [ ] Optional extension ingest endpoint
- [ ] Dorking/directories source labels

## v8.14 Dorking Settings

- [ ] Industry/location/signal profiles
- [ ] Send settings to extension

## v8.15 Dashboard

- [ ] KPIs from cloud data
- [ ] Sender performance
- [ ] Template performance
- [ ] Research progress

## v8.16 Data Safety

- [ ] Workspace export/import
- [ ] Backup scouted history
- [ ] Restore old local data


## v8.3 Completed

- Native CSV upload/import page.
- 100,000 usable row limit.
- Chunked duplicate checks against businesses and scout_history.
- Chunked Supabase inserts.
- Invalid row export.
- Skipped duplicate export.
- Different target/campaign warning.
- Real error rendering instead of `[object Object]`.
