# Scout v10.35.1 Scale Guard — Validation Report

Validation date: 2026-07-16

## Result

The source package passed clean installation, static validation, TypeScript validation, SQL parsing, production compilation and a production build after being extracted from the generated ZIP.

## Previous deployment failure corrected

The earlier v10.35 deployment stopped at `npm ci` before GitHub was changed. The previous lockfile contained private internal package-registry URLs. v10.35.1 contains only public `https://registry.npmjs.org/` package URLs.

The package engine now accepts Node versions 22 through 24 (`>=22 <25`), so the user's Node 24 installation is no longer outside the declared engine range. The deployment script also explicitly forces the public npm registry and uses `npm ci --legacy-peer-deps`.

## Checks completed

- `npm ci --legacy-peer-deps --registry=https://registry.npmjs.org/`: passed from a newly extracted ZIP.
- Static Scale Guard validation: 38/38 passed.
- TypeScript `tsc --noEmit`: passed.
- `RUN_THIS_SQL_FIRST_V10_35.sql`: parsed successfully as 34 PostgreSQL statements.
- `RUN_THIS_SQL_FIRST_V10_35_1_SCALE_GUARD.sql`: parsed successfully as 53 PostgreSQL statements.
- Production `next build`: passed.
- Static-generation tasks: 51/51 completed.
- Newly extracted ZIP production build: passed.
- Deployment script syntax (`bash -n`): passed.
- ZIP compressed-data integrity: passed.
- Private registry string scan: zero matches.
- `node_modules`, `.next`, build cache and backup files: excluded from the ZIP.

## Scale and security checks

- Browser schedule polling removed from `AppOpenRunner`.
- Central worker script included.
- Platform-wide campaign leases included.
- Platform-wide and per-workspace Gmail sender-lane leases included.
- Direct one-off Gmail sends use the same sender-lane capacity guard.
- Duplicate campaign execution is refused.
- Lease RPCs are service-role-only.
- Gmail account listing is server-paginated and searchable.
- OAuth access and refresh tokens are excluded from the safe browser account-list API.
- Raw manual token entry is hidden by default behind a development-only feature flag.
- Sender lifetime totals use a lightweight summary table and trigger.
- Deliverability uses grouped summary queries.
- Worker progress writes are batched.
- Empty pacing passes do not create empty outreach-batch rows.
- Worker rotates through all due connected accounts instead of considering only the first small subset.
- Send-only OAuth remains active for Google verification.
- Restricted reply reading and Gmail-native signature synchronization remain coded but disabled by default.
- Team pagination, duplicate ownership, signatures, account deletion and current v10.35 features remain.

## SQL safety

The v10.35.1 migration is additive. It contains no `DROP TABLE`, `DROP SCHEMA`, or `DROP COLUMN` statement and does not rewrite workspace membership or admin roles. It includes a prerequisite check that stops with a clear error if the original v10.35 SQL has not been applied.

No automatic history deletion or retention cleanup is activated by this patch.

## Operational requirement

The central Render Background Worker must be configured after deployment using `RENDER_SCALE_GUARD_WORKER_SETUP_V10_35_1.txt`. Without that continuously running worker, the first immediate pass can start, but queued continuations and future scheduled work will not be processed reliably.

## Not tested against live production services

The package was not deployed to the user's GitHub, Vercel, Supabase, Render or Google Cloud accounts. Live Gmail sending, production OAuth approval, real Supabase data and real concurrent-user load still require the controlled post-deployment test in `EXACT_ROLLOUT_STEPS_V10_35_1.txt`.
