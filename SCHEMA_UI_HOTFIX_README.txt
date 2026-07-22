SCOUT v10.40.1 — TEMPLATE SCHEMA + SETTINGS COPY HOTFIX

WHY THIS HOTFIX EXISTS
- The v10.40 schema readiness checker incorrectly requested templates.body.
- Scout templates actually store their message text in templates.message.
- The Settings page also retained two stale send-only descriptions even though full reply reading and Gmail signature permissions are active in this build.

WHAT CHANGED
- The schema contract now checks templates.message.
- No database column is added and no SQL migration is required.
- Settings now describes send, Scout-thread reply reading, and Gmail signature permissions accurately.
- The live health marker is full-replies-signature-schema-ui-hotfix.

DEPLOYMENT
Use DEPLOY_V10_40_0_FULL_GIT_BASH.sh. It validates version 10.40.1, runs npm ci, static checks, SQL-contract checks, TypeScript, and a production build before pushing GitHub main.
