# Scout App v8.32 — Final Timezone + Tracking + Extension Bridge

## What changed

### 1. Dashboard send-time intelligence
- Added compact **Best Sending Time** strip at the top of `/dashboard`.
- Shows only six markets to avoid information overload:
  - US East
  - US West
  - Canada default Toronto
  - Germany
  - France
  - Spain
- Scout scores each market using the buyer/market local time, but every recommended next-send time is displayed in the logged-in user's browser timezone.

### 2. Reply tracking is no longer capped at 1,000
- `/replies` now uses exact Supabase count queries for:
  - Sent Tracked
  - Real Replies
  - Auto Replies
  - No Inbox / Blocked
- The recent tables still load only recent rows for speed, but KPI totals are all-time workspace counts.

### 3. Automatic sync defaults hardened
- Operations Autopilot now defaults reply/bounce scanning to 500 Gmail messages over 90 days per connected account.
- This keeps tracking automatic when the hourly Vercel cron runs `/api/workers/run-all`.

### 4. Extension ingest is now the main import bridge
- `/api/extension/ingest` accepts rows from the extension using the workspace key.
- Direct-email leads are imported as `ready`.
- Website-only leads are imported as `pending` and queued for Auto Scout.
- Duplicate prevention remains based on `workspace_id + normalized_key`.

### 5. Dork settings helper endpoint
- Added `/api/extension/dork-settings` so the extension can sync/save dorking settings without a separate backend server.

## Important tracking meaning

`Sent Tracked` means Gmail accepted the send and Scout saved it in `sent_messages`.

Gmail does not provide a universal real-time “delivered to inbox” confirmation. Scout treats a Gmail-accepted send as tracked, then updates it later if a bounce, no-inbox, blocked notice, auto reply, or real human reply is detected.

So the correct flow is:

```text
Sent Tracked → Gmail accepted it
No Inbox / Blocked → Gmail later returned a delivery failure or block
Auto Replies → automated response, not counted as human reply
Real Replies → human reply, counted as response
```
