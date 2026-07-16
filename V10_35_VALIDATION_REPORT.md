# Scout v10.35 validation report

Release: **Scout v10.35 — Safe Sending & Google Verification**
Baseline: supplied working Scout v10.34 package.

## Scope controls

- No table, schema, or column drop is present in the v10.35 SQL.
- No workspace-membership, admin-role, signup, upload, country, or lead-ownership redesign is included.
- Existing reply-sync and Gmail-native signature-sync implementations remain in the source but default to disabled.
- New Gmail OAuth requests `openid`, `email`, `profile`, and `gmail.send` only.
- The ordinary user flow remains Connect Gmail → choose template/recipients → send.

## Automated static validation

`npm run validate:v10.35` passed **30/30** checks, including:

- send-only OAuth and signed, session-bound OAuth state
- OpenID user identity without Gmail inbox access
- restricted Gmail scopes excluded from the authorization request
- restricted sync routes protected by workspace membership
- atomic capacity for direct, scheduled, placement-test, and manual-reply sends
- successful reservation IDs linked to sent history
- calendar-day and rolling-24-hour quota logic
- service-role-only reservation RPC execution
- healthy-only 3-second Fast mode
- randomized Warm-up and Normal pacing
- capped background sender lanes
- one-message placement testing without reading the receiving inbox
- server-side Team pagination and search
- exact `DELETE` confirmation and anonymous duplicate-fingerprint retention
- public verification pages and Google Limited Use disclosure
- additive SQL with no workspace/admin-role rewrite

## TypeScript and SQL

- `tsc --noEmit`: passed.
- `RUN_THIS_SQL_FIRST_V10_35.sql`: parsed successfully with PostgreSQL parser, 34 statements.
- Supabase migration copy: parsed successfully, 34 statements.
- The two v10.35 SQL files are identical.
- Destructive SQL token audit: no `DROP TABLE`, `DROP SCHEMA`, or `DROP COLUMN`.

## OAuth source audit

- The only direct Google authorization URL is in `app/api/gmail/oauth/start/route.ts`.
- No `gmail.readonly`, `gmail.settings.basic`, `gmail.modify`, `gmail.metadata`, `gmail.compose`, or full-mail scope is present in the active authorization source.
- Gmail access and refresh tokens remain server-side and are not returned by the Gmail profile endpoint.

## Production build

A clean production build passed with:

- Node 22-compatible dependency set
- Next.js 16.2.10
- TypeScript validation
- optimized compilation
- all 50 static-generation tasks completed
- complete application route manifest generated

The Next.js middleware deprecation message is a framework warning; the existing middleware remains compiled as the application proxy and was not redesigned in this release.

## Operational validation still required after deployment

No offline build can authorize a real Gmail account or write to the production Supabase project. After deployment, perform the controlled test in `EXACT_ROLLOUT_STEPS_V10_35.txt` before any larger sending run.

Google verification and inbox placement are external outcomes and are not guaranteed by a successful software build.
