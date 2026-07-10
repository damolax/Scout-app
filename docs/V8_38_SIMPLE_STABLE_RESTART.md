# Scout App v8.38 — Simple Stable Restart

This version is a cleanup build after v8.36/v8.37 became too crowded.

## Main changes

- Left sidebar reduced to 7 main tabs:
  - Dashboard
  - Scout & Import
  - Leads
  - Outreach
  - Inbox
  - Automation
  - Settings
- Notifications are no longer a sidebar tab.
- Notification bell moved to the top right.
- Clicking the bell opens a compact popover with recent notifications.
- Notification popup supports refresh, mark all read, and mark one read.
- Related pages are still available through small quick-link cards inside the grouped tabs.
- Added `/api/health` to quickly check whether the deployed app has required environment variables.
- Kept Vercel Hobby safe `vercel.json` with no hourly cron.
- External cron should call `/api/workers/run-all` every 15 minutes.

## Real app URL for this deployment

Use this as the Scout app URL:

```text
https://scout-app-oyeola.vercel.app
```

## Existing Render backend URL

Keep this as the backend/email finder URL:

```text
https://scout-email-finder.onrender.com
```

## Required Vercel env variables

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_BACKEND_URL=https://scout-email-finder.onrender.com
NEXT_PUBLIC_ADMIN_EMAIL=
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RUN_ALL_WORKER_SECRET=
SCOUT_DEFAULT_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
```

## Health check

After deploy, open:

```text
https://scout-app-oyeola.vercel.app/api/health
```

It should return JSON booleans showing which environment variables are configured.

## External cron URL

Use cron-job.org or another external cron to call:

```text
https://scout-app-oyeola.vercel.app/api/workers/run-all?workspaceId=00000000-0000-4000-8000-000000000001&includeSeedTest=false&token=YOUR_RUN_ALL_WORKER_SECRET
```

## If the app opens Vercel SSO

Disable Vercel deployment protection / Vercel authentication for the production deployment, otherwise users will see Vercel authentication before Scout can load.
