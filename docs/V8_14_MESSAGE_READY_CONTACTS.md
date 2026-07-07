# Scout App v8.14 — Message + Ready Contacts

This release changes Email Scout into Message and fixes Ready-to-message visibility.

## Changes

- Navigation now shows Message instead of Email Scout.
- Added `/message` as the main outreach route while keeping the old `/email-scout` route available.
- Business detail and business table message buttons now open `/message?business=<id>`.
- Message page shows the total number of Ready-to-message contacts, not just the 100-row preview.
- If no contacts are selected, batch sending pulls the requested number of Ready contacts directly from Supabase. It is no longer limited to the visible preview table.
- Added Repair Ready List button to route businesses with emails to Ready and no-email businesses to Pending.
- Fixed wording around Ready contacts and recent sent logs.

## Expected flow

Import contacts with emails -> Ready for Message.
Import contacts without emails -> Pending for Auto Scout.
Auto Scout finds emails -> Ready Email Detection -> Ready for Message.
Message sends to Ready contacts and moves sent contacts to Contacted only after successful send.
