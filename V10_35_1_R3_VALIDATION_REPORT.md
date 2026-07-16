# Scout v10.35.1 Scale Guard R3 — Validation Report

## Reported production error

PostgreSQL stopped the R2 lifetime-summary backfill with:

`23503: insert or update on table scout_sender_lifetime_stats violates foreign key constraint`

The referenced `gmail_account_id` existed in historical `sent_messages`, but no longer
existed in `gmail_accounts`. This can happen because older Scout releases retained sent
history after a connected Gmail account was removed and did not enforce a foreign key on
`sent_messages.gmail_account_id`.

## R3 repair

R3 preserves the historical sent-message rows. It does not null, delete, or rewrite them.

The migration now:

- Builds active sender lifetime totals only by joining `sent_messages` to an existing
  `gmail_accounts` row in the same workspace.
- Emits a PostgreSQL NOTICE with the number of historical rows skipped.
- Guards the future lifetime-stat trigger so a stale/deleted Gmail reference cannot make
  a new `sent_messages` insert fail.
- Keeps the R2 compatibility support for the older `seed_inbox_tests` column layout.
- Copies a legacy seed sender ID into the new FK-backed column only when that Gmail
  account still exists in the matching workspace.
- Remains additive and idempotent.

## Validation completed

- PostgreSQL syntax parsing with `pglast`: **61 statements parsed successfully**.
- Scout v10.35.1 static validation: **42/42 checks passed**.
- R3 lifetime backfill active-account join: passed.
- R3 workspace-match guard: passed.
- R3 future trigger existence guard: passed.
- R2 seed-test compatibility checks: passed.
- Destructive migration scan: no `DROP TABLE`, `DROP SCHEMA`, or `DROP COLUMN`.
- Application source code: unchanged from the R2 package; R3 changes only the migration,
  migration validation, deployment guard, and rollout documentation.

A fresh npm installation was started for repeat application compilation, but the package
registry operation did not complete within the execution window. No claim of a new R3
application compilation is made. The previously validated R2 application code is unchanged;
the corrected R3 SQL itself passed PostgreSQL parsing and all 42 migration/static checks.
