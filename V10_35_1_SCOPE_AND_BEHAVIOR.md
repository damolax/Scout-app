# Scout v10.35.1 — Scale Guard

## Purpose

This patch keeps the v10.35 user workflow and features while making Scout safer for approximately 200 simultaneous users and up to 150 connected Gmail accounts in one workspace.

Normal users still follow the same steps:

1. Connect Gmail.
2. Select recipients and a template.
3. Click Send.
4. Scout queues and processes the job safely in the background.

## What changes

- Scheduled campaigns are claimed by one central worker instead of every open browser checking every five seconds.
- Database-backed campaign leases limit the initial platform capacity to 12 concurrent campaigns and one campaign per workspace.
- Database-backed sender leases limit the initial platform capacity to 12 active Gmail sender lanes and two lanes per workspace.
- Jobs rotate fairly between workspaces. Connecting 150 Gmail accounts does not activate all 150 at once.
- Settings shows 25 Gmail accounts per page with search and status filters.
- Gmail account statistics are aggregated server-side; the page no longer runs one lifetime-history query per account.
- OAuth access and refresh tokens are excluded from the safe account-list API returned to browser pages.
- Deliverability uses a grouped seven-day sender summary instead of loading thousands of history rows.
- Message progress is written in batches instead of after every minor state change.
- Browser polling is reduced and pauses in hidden tabs.
- Sent Today, rolling 24-hour usage, lifetime totals, daily limits, per-run limits, safety modes, signatures, suppression and team duplicate protection remain.
- Google OAuth remains send-only for the first verification submission. Reply sync and Gmail-native signature sync remain in code behind disabled feature flags.

## Capacity defaults

- Platform active campaigns: 12
- Active campaign per workspace: 1
- Platform active sender lanes: 12
- Active sender lanes per workspace: 2
- Central worker interval: 10 seconds
- Campaign passes per worker tick: 6
- Sender page size: 25

The administrator can increase these values later after load testing and infrastructure upgrades. They are operational controls, not permanent product limits.

## Data safety

- The SQL migration is additive.
- No table, workspace, user, role, business, template, Gmail connection or sent-history record is dropped.
- No automatic retention deletion is enabled in this patch.
- Anonymous team lead fingerprints remain available for duplicate prevention.
- OAuth tokens remain available only to server-side sending and token-refresh routes.

## Required deployment dependency

The central worker must run continuously after deployment. The package includes `scripts/scale-guard-worker.mjs` and `npm run worker:scale-guard`. Configure it as a Render Background Worker using `RENDER_SCALE_GUARD_WORKER_SETUP_V10_35_1.txt`.
