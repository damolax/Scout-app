# Scout App v8.22 — Sender Settings, Seed Inbox Tests, Spam Guard

## Added

- Sender default limits in Settings:
  - account type
  - daily safe limit
  - default max per run
  - seed inbox enabled
  - seed test address
- Message now uses sender settings as the default cap.
- Message still allows per-run override.
- Spam Guard checks previewed subject/body before sending.
- High-risk messages are blocked unless the user intentionally overrides.
- Seed inbox test route:
  - `/api/gmail/seed-test/run`
- Vercel daily cron calls the seed test every day at 07:00 UTC.
- Seed test results are saved to `seed_inbox_tests`.
- Sender seed risk is saved on `gmail_accounts`.
- Migration adds compatibility function for `get_due_followups(limit_rows, target_workspace)`.

## Notes

Seed tests only measure Gmail inboxes connected to Scout as seed inboxes. They cannot prove placement inside random prospect inboxes.
