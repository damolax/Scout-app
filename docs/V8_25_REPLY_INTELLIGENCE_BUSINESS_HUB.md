# Scout App v8.25 — Reply Intelligence + Business Conversation Hub

## What changed

- Separates inbound Gmail messages into real replies, auto replies, no-inbox/address-not-found, message blocked, bounce notice, Gmail limit notice, temporary failure, unmatched, and ignored.
- Auto replies are tracked as inbound replies, but not counted as real human replies.
- If an auto-reply business later sends a human reply, the business reply state is moved to real_reply and status becomes responded.
- No-inbox/address-not-found records are moved to No Inbox and never counted as replies.
- Message-blocked and bounce notices are tracked as delivery failures and not counted as replies.
- Gmail limit notices pause the sender for 24 hours and are not tied to a prospect reply.
- Business detail page now includes a full conversation timeline and a manual Gmail reply composer.
- No Inbox and Replies rows now link back to the business record when a business match exists.

## Supabase migration

Run:

```sql
-- supabase/migrations/202607090825_reply_intelligence_business_hub.sql
```

After it returns `pg_notify`, refresh the app.

## Reply buckets

- real_reply — human response, counts as a real reply.
- auto_reply — automated response, tracked separately.
- no_inbox — address not found / no such user, moves to No Inbox.
- blocked — message blocked / policy / spam blocking, delivery failure.
- bounce_notice — bounce notice, delivery failure.
- limit_notice — Gmail quota/rate/sending-limit notice, pauses sender.
- temporary_failure — temporary provider issue, not counted as reply.
- unmatched — inbound message that could not be matched to a sent business.
- ignored — self/irrelevant messages.
