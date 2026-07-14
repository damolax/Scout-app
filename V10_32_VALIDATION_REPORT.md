# Scout v10.32 Validation Report

## Baseline comparison

- Baseline: user-supplied Scout v10.30.0 ZIP (`v1030work`).
- Workspace architecture remains read-only during normal page loads.
- No `account-provisioning`, `provisionUserAccount` or `repair_my_scout_account` references exist.
- No workspace-membership query uses `.single()` or `.maybeSingle()` in the updated application paths.
- No later experimental lead-claim tables or RPCs remain in the application.

## Build validation

Passed on the complete working directory:

- `npm ci`
- `npm run typecheck`
- `npm run build`
- Next.js production compilation
- 42 static/dynamic application routes generated

Non-blocking Next.js warnings remain from the original application about the middleware naming convention and `themeColor` metadata placement.

## SQL validation

- `RUN_THIS_SQL_ONCE_V10_32.sql` parsed successfully using PostgreSQL `pglast`.
- The migration contains no advisory locks and no row-by-row account/workspace repair loop.
- The category-aware import function is dropped and recreated deliberately, avoiding PostgreSQL return-type conflict `42P13`.
- The existing v10.30 team registry is strengthened in place; no replacement ownership schema is introduced.

## Team-ownership validation

Identity-key tests passed for:

- Same exact email.
- Different emails on the same genuine business domain.
- Same normalized phone.
- Existing legacy normalized key.
- Public/platform domains such as Gmail and Facebook are ignored as business-domain claims.
- Team ownership is checked on CSV import, Source Scout, Auto Source Scout, extension imports, Send Now and durable/scheduled sends.

## Supplied CSV validation

File: `export_part_3.csv`

- Rows parsed: 10,000
- Invalid rows: 0
- CSV parser errors: 0
- Headers: 24

Country resolution:

- Unassigned: 5,090
- Canada: 4,890
- United States: 4
- Australia: 3
- Pakistan: 2
- United Kingdom: 2
- Vietnam: 1
- Germany: 1
- Lebanon: 1
- Mexico: 1
- Switzerland: 1
- New Zealand: 1
- Japan: 1
- Sri Lanka: 1
- France: 1

Unassigned rows remain visible and are not guessed into a country.

## Template-country routing tests

Passed examples:

- Germany assigned to German → German content selected.
- France assigned to French → French content selected.
- Portugal assigned to Portuguese (Portugal) → Portuguese content selected.
- Canada assigned to English → English selected even when an uploaded language differs.
- A language with incomplete subject/body → English fallback.
- One country cannot be assigned to two languages inside the same template.

## Important limitation

Compilation, parser checks and local data tests do not substitute for a live Supabase/Vercel test. After deployment, test login/workspace, one new signup, one small upload, one Send Now message, one scheduled batch and password reset before using a large production batch.
