# Scout v10.33 validation report

## Live audit used

The migration was written against the uploaded live Supabase audit generated on 2026-07-14.
The audit showed:

- 8 Auth users;
- 5 profiles;
- 5 workspaces;
- 5 memberships;
- 3 users missing profiles and memberships;
- 4 regular users with workspace role `admin`;
- `is_workspace_member()` returning true for every authenticated user;
- `profiles.full_name` already available;
- `templates.raw` available for translation/country configuration;
- `gmail_accounts.daily_limit = 450` and `default_run_limit = 50`.

## Code validation

- `npm ci`: passed.
- TypeScript `tsc --noEmit`: passed.
- Next.js production build: passed.
- 42 application routes generated.
- Git staged-diff whitespace validation against v10.32: passed.

## SQL validation

- PostgreSQL syntax parsed successfully with `pglast`.
- The migration is transactional.
- It preserves businesses, sent messages, reply history, templates, Gmail accounts, and existing valid workspaces.
- It creates workspaces only for Auth users who do not already own a valid personal workspace.
- It outputs a verification JSON object after completion.

## Required rollout order

1. Run `RUN_THIS_SQL_FIRST_V10_33_ACCESS_RECOVERY.sql` in Supabase.
2. Confirm the verification result reports zero missing profiles/memberships and zero regular admin memberships.
3. Sign out and sign in to test Dashboard, Businesses, Messages, and Templates.
4. Deploy the v10.33 code package.
5. Test a new account with Full name, Email, and Password.

## Final downloadable ZIP validation

The exact `scout-app-v10-33-access-recovery.zip` was extracted into a clean directory and passed:

- package/version verification;
- deployment-script shell syntax validation;
- PostgreSQL syntax parsing;
- clean dependency installation;
- TypeScript validation;
- full Next.js production build;
- generation of all 42 application routes.

All application-side membership checks were also changed from "approved membership" to explicit workspace membership. The database keeps `approved = true` only for compatibility; it is no longer an access or manual-approval condition.
