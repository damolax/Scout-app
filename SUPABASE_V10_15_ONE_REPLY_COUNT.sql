-- Scout v10.15: one reply count everywhere
-- Goal: do not hide useful replies because of strict auto/human classification.
-- A reply is any inbound message that is not a bounce, blocked notice, no-inbox notice, or Gmail limit notice.

update public.reply_history
set
  is_real_reply = false,
  is_auto_reply = false,
  reply_bucket = coalesce(nullif(reply_bucket, ''), classification, 'delivery_problem'),
  updated_at = coalesce(updated_at, now())
where workspace_id is not null
  and (
    coalesce(is_delivery_failure, false) = true
    or coalesce(is_blocked, false) = true
    or coalesce(is_limit_notice, false) = true
    or lower(coalesce(classification, '')) in ('no_inbox','message_blocked','bounce_notice','gmail_limit_notice','no_inbox_or_bounce','delivery_failure')
    or lower(coalesce(reply_bucket, '')) in ('no_inbox','blocked','bounce_notice','gmail_limit_notice','limit_notice','no_inbox_or_bounce')
  );

update public.reply_history
set
  is_real_reply = true,
  is_auto_reply = false,
  classification = 'real_reply',
  reply_bucket = 'real_reply',
  updated_at = coalesce(updated_at, now())
where workspace_id is not null
  and coalesce(is_delivery_failure, false) = false
  and coalesce(is_blocked, false) = false
  and coalesce(is_limit_notice, false) = false
  and lower(coalesce(classification, '')) not in ('no_inbox','message_blocked','bounce_notice','gmail_limit_notice','no_inbox_or_bounce','delivery_failure','self_message_ignored','unmatched_inbound')
  and lower(coalesce(reply_bucket, '')) not in ('no_inbox','blocked','bounce_notice','gmail_limit_notice','limit_notice','no_inbox_or_bounce','ignored','unmatched');

-- Mark businesses as responded when they have at least one counted reply.
update public.businesses b
set status = 'responded'
where exists (
  select 1
  from public.reply_history r
  where r.workspace_id = b.workspace_id
    and r.business_id = b.id
    and coalesce(r.is_real_reply, false) = true
)
and coalesce(b.status, '') not in ('archived','deleted','no_inbox','bounced','blocked');

notify pgrst, 'reload schema';
