# v8.21 Message Blocked + Sender Caps

## Added

- Message page supports per-sender run caps.
- Total batch size still controls the overall run.
- Each selected Gmail can now have its own max for the current run, such as 50, 100, 150.
- Blank sender cap means auto-fill the remaining rotation.
- Saved schedules now store selected sender run limits in the schedule raw payload.
- Gmail send API now classifies message-blocked/policy/spam-style send failures as `message_blocked` instead of generic failed.
- Message page includes `Sync Bounces/Blocked`.
- New route: `/api/gmail/sync-bounces` scans connected Gmail for delivery-failure, no-inbox, and message-blocked notices.
- Sync writes false replies to `reply_history`, writes records to `no_inbox_records`, and updates sent message delivery status.

## Notes

Message blocked is not always the same as no inbox. It can mean content, sender reputation, authentication, policy, attachment/link, or rate/reputation issue. No-inbox/bounce means the recipient address/mailbox is invalid or unavailable.

No tool can guarantee removal of all spam words or guarantee inbox placement. The app should use preflight checks, bounce sync, sender rotation, and reputation monitoring.
