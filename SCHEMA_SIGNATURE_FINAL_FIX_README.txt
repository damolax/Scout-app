SCOUT v10.40.0 — SCHEMA READINESS + SIGNATURE FINAL FIX

Cause corrected:
- The earlier upgrade SQL recorded schema 10.40.0 but did not add workspace email_signature_text, email_signature_html, and email_logo_url to every historical Scout database.
- The runtime schema checker checks the complete workspaces table in one request, so those missing columns appeared as one missing database requirement.
- The Settings signature buttons were disabled by the unrelated global schema gate.
- Old send-only labels remained hard-coded in Settings.

Fixes:
- Adds an idempotent schema-health repair SQL.
- Adds the missing workspace signature columns and reconciles all runtime contract fields.
- Makes Scout signature saving independent of the global readiness gate.
- Keeps native Gmail sync as a separate action.
- Replaces stale send-only text.
- Expands verification SQL to match the real runtime contract.
- Uses live build marker full-replies-signature-schema-final-fix.
