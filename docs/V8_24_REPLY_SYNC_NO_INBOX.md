# Scout App v8.24 — Reply Sync + No-Inbox Tracker Final

This version makes reply and delivery-failure tracking native inside the Scout web app.

## Added

- New native API route: `/api/gmail/sync-replies`
- Rebuilt bounce route: `/api/gmail/sync-bounces`
- Gmail API reads connected sender inboxes directly using stored OAuth tokens
- Real prospect replies are matched to `sent_messages`
- Real replies update businesses to `responded`
- Address-not-found/no-inbox messages update businesses to `no_inbox`
- Message-blocked/bounce notices are saved as delivery-failure records
- Out-of-office, Gmail limits, self messages, and unmatched inbox messages do not count as real replies
- Replies page uses the native sync route instead of depending on Render/backend reply endpoints
- No Inbox page now shows actual `no_inbox_records`, not only business statuses

## What counts as a real reply

A message counts as a real response only when it matches a previously sent message by Gmail thread or recipient email and does not look like a bounce, no-inbox, auto-reply, or Gmail/system notice.

## Still not included

Scheduled automatic sending is still a later worker version. v8.24 focuses on reading and classifying inbound replies/delivery failures.
