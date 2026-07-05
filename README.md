# Scout App v8 Cloud

Clean multi-page Scout App rebuilt with Next.js + Supabase login/cloud sync.

## What changed from v7.5

- No more one giant `index.html`.
- Email/password login with Supabase Auth.
- Everyone who signs up is auto-approved into the default workspace.
- Admin email: `oyekunleolalekan3168@gmail.com`.
- Queue, imports, templates, scout history, replies, no-inbox records, and backups are cloud tables.
- Extension stays login-free. It can keep exporting CSVs for Upload Lists.
- Existing backend stays responsible for Gmail OAuth, sending, reading replies, and bounce/no-inbox handling.

## Folder structure

```txt
app/
  login/
  (app)/dashboard/
  (app)/upload/
  (app)/businesses/
  (app)/verify/
  (app)/auto-scout/
  (app)/email-scout/
  (app)/replies/
  (app)/no-inbox/
  (app)/data-safety/
  (app)/settings/
components/
lib/
supabase/migrations/
```

## Setup

### 1. Create Supabase project

Create a Supabase project, then open SQL Editor and run:

```txt
supabase/migrations/202607050001_scout_v8_cloud.sql
```

### 2. Auth settings

For immediate login without email confirmation:

```txt
Supabase Dashboard → Authentication → Providers → Email
Disable Confirm email
Enable email/password signups
```

If you want confirmation emails later, configure Custom SMTP first.

### 3. Environment variables

Copy `.env.example` to `.env.local` locally and add the same values in Vercel:

```txt
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_BACKEND_URL=https://scout-email-finder.onrender.com
NEXT_PUBLIC_ADMIN_EMAIL=oyekunleolalekan3168@gmail.com
```

Only server routes use `SUPABASE_SERVICE_ROLE_KEY`. Never expose it in frontend code.

### 4. Install and run

```bash
npm install
npm run dev
```

### 5. Deploy to Vercel

Push this folder to `damolax/Scout-app`, set the environment variables in Vercel, then deploy.

## Extension

The extension does not need login. Keep it as a browser tool for Google dorking and directory scouting.

Main workflow:

```txt
Extension scouts/downloads CSV
→ Scout App Upload Lists imports CSV
→ Supabase dedupes against current queue and team scout_history
→ Only fresh businesses enter the cloud queue
```

Optional future workflow:

```txt
Extension stores workspace API key locally
→ POST /api/extension/ingest
→ Scout App receives extension results directly
```

The API key is visible under Settings.

## Gmail / Send / Reply handling

Keep the existing backend. Supabase Auth handles app login. Supabase database stores the records. Gmail OAuth, Gmail API sending, reply reading, bounce/no-inbox classification, and rate handling should remain in the backend.

## Migrating old v7 local data

Open the deployed v8 app in the same browser/profile where your old v7 localStorage exists, then go to:

```txt
Data Safety → Download local v7 scouted history
Data Safety → Import local v7 history into cloud
```

This reads the old key:

```txt
scout_team_scouted_local_v64
```

and saves it into Supabase `scout_history`, skipping duplicates.

## Import behavior

Upload CSV:

```txt
Preview rows
→ normalize email/domain/website/phone/name
→ remove duplicate rows inside CSV
→ check current Supabase queue
→ check team scout_history
→ import only fresh businesses
→ show skipped counts
→ download skipped duplicates
```

## Notes

This is a foundation build. It keeps the old backend and extension separate so the app can be stabilized without breaking Gmail or browser automation.


## v8 Hybrid Recovery Note

This build keeps the Next.js/Supabase login shell and adds `/main-scout`, which serves the working Main Scout App App feature set from `legacy/scout-classic.html` behind login.

Use `/main-scout` for the full old Scout App features while the cloud-native v8 pages are migrated gradually. This keeps Gmail OAuth, dorking, Auto Scout, Verify, Email Scout, templates, settings, dashboard, and local browser workflows available instead of replacing them with skeleton pages.


## Main Scout App feature preservation

This build keeps the Node/Next/Supabase shell and mounts the working v73 Scout App feature set at `/main-scout`. The old `/classic` route redirects to `/main-scout` for compatibility.

Use `/main-scout` for the complete working feature set now: dorking, OAuth/Gmail settings, email scout, batch sending, replies, no-inbox/bounce handling, verification, timeline, dashboard, templates, local dedupe, and CSV import. Native cloud pages remain available for gradual migration.
