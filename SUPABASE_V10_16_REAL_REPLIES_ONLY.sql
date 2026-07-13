-- Scout v10.16: real replies only for dashboard, challenges, scouting level, and reply filters.
-- Auto messages are kept in reply_history, but they do NOT count as Real Replies.

alter table if exists public.reply_history add column if not exists updated_at timestamptz;
alter table if exists public.reply_history add column if not exists reply_bucket text;
alter table if exists public.reply_history add column if not exists is_real_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists is_auto_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists is_delivery_failure boolean not null default false;
alter table if exists public.reply_history add column if not exists is_blocked boolean not null default false;
alter table if exists public.reply_history add column if not exists is_limit_notice boolean not null default false;

-- Reset only classification flags. Keep every reply record.
update public.reply_history
set
  is_real_reply = false,
  is_auto_reply = false,
  is_delivery_failure = coalesce(is_delivery_failure, false),
  is_blocked = coalesce(is_blocked, false),
  is_limit_notice = coalesce(is_limit_notice, false),
  reply_bucket = coalesce(reply_bucket, 'review'),
  updated_at = now();

-- Delivery/bounce/limit messages: not replies.
update public.reply_history
set
  is_real_reply = false,
  is_auto_reply = false,
  is_delivery_failure = true,
  reply_bucket = 'bad_delivery',
  updated_at = now()
where lower(coalesce(from_email, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(snippet, '') || ' ' || coalesce(body, '')) like any (array[
  '%mailer-daemon%', '%mail delivery subsystem%', '%postmaster%', '%delivery status notification%',
  '%undeliverable%', '%message not delivered%', '%delivery incomplete%', '%delivery failed%',
  '%address not found%', '%recipient address rejected%', '%no such user%', '%user unknown%',
  '%mailbox unavailable%', '%mailbox not found%', '%does not exist%', '%quota exceeded%',
  '%sending limit%', '%daily user sending quota exceeded%', '%rate limit%', '%gmail limit%'
]);

-- Blocked/no-inbox messages: not replies.
update public.reply_history
set
  is_real_reply = false,
  is_auto_reply = false,
  is_blocked = true,
  reply_bucket = 'blocked_or_no_inbox',
  updated_at = now()
where coalesce(is_delivery_failure, false) = false
  and lower(coalesce(from_email, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(snippet, '') || ' ' || coalesce(body, '')) like any (array[
    '%message blocked%', '%blocked%', '%blacklist%', '%spam policy%', '%rejected as spam%',
    '%not accepting mail%', '%no inbox%', '%recipient rejected%'
  ]);

-- Auto messages: ticket receipts, feedback surveys, out-of-office, acknowledgement, do-not-reply.
update public.reply_history
set
  is_real_reply = false,
  is_auto_reply = true,
  reply_bucket = 'auto_reply',
  updated_at = now()
where coalesce(is_delivery_failure, false) = false
  and coalesce(is_blocked, false) = false
  and lower(coalesce(from_email, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(snippet, '') || ' ' || coalesce(body, '')) like any (array[
    '%noreply%', '%no-reply%', '%do-not-reply%', '%donotreply%',
    '%automatic reply%', '%automatic response%', '%automatische antwort%', '%auto:%', '%auto reply%', '%auto-reply%', '%autoreply%',
    '%out of office%', '%out-of-office%', '%currently out of office%', '%away from the office%', '%limited access to email%',
    '%this is an automated response%', '%this is an automated reply%', '%this is an automatic response%', '%automated notification%',
    '%this mailbox is not monitored%', '%this inbox is not monitored%', '%please do not reply%',
    '%your request has been received%', '%we have received your request%', '%we received your request%', '%received your request%',
    '%your message has been received%', '%we have received your message%', '%we received your message%', '%received your message%',
    '%request received%', '%ticket received%', '%case received%', '%ticket created%', '%case created%', '%has been created%',
    '%support ticket%', '%case number%', '%ticket number%', '%ticket id%', '%request #%', '%delivered by zendesk%', '%zendesk%', '%reamaze%', '%freshdesk%', '%gorgias%',
    '%please type your reply above this line%', '%to add additional comments, reply to this email%',
    '%confirmation of receipt%', '%receipt of your email%', '%thank you for your recent email%', '%thanks for contacting support%',
    '%we will get back to you%', '%we will be in touch%', '%we’ll be in touch%', '%we will contact you shortly%',
    '%within 24 hours%', '%within 48 hours%', '%response time:%', '%feedback%', '%how satisfied%', '%rate our support%',
    '%teilen sie uns ihr feedback mit%', '%zufriedenheit%', '%bearbeitung ihrer anfrage%', '%bearbeitung deiner anfrage%',
    '%eingangsbestätigung%', '%empfangsbestätigung%', '%anfrage eingegangen%', '%anfrage ist bei uns eingegangen%',
    '%ihre anfrage ist bei uns eingegangen%', '%deine anfrage ist bei uns eingegangen%',
    '%ihre nachricht ist bei uns eingegangen%', '%deine nachricht ist bei uns eingegangen%',
    '%wir haben deine nachricht erhalten%', '%wir haben ihre nachricht erhalten%', '%wir haben ihre e-mail erhalten%',
    '%anliegen wurde erstellt%', '%wurde erstellt%', '%ticketnummer%', '%ticket-nummer%', '%bearbeitungszeit%',
    '%nous confirmons la réception%', '%votre demande a été reçue%', '%merci de nous avoir contactés%',
    '%hemos recibido%', '%su solicitud ha sido recibida%', '%abbiamo ricevuto%'
  ]);

-- Human-looking replies. If it is not a bounce/block/auto message, count it as a real reply.
-- This keeps real negative replies, price questions, criticism, and “not interested” replies.
update public.reply_history
set
  is_real_reply = true,
  is_auto_reply = false,
  reply_bucket = 'real_reply',
  updated_at = now()
where coalesce(is_delivery_failure, false) = false
  and coalesce(is_blocked, false) = false
  and coalesce(is_limit_notice, false) = false
  and coalesce(is_auto_reply, false) = false;

create index if not exists reply_history_workspace_real_received_idx
on public.reply_history(workspace_id, is_real_reply, received_at desc);

create index if not exists reply_history_workspace_auto_received_idx
on public.reply_history(workspace_id, is_auto_reply, received_at desc);

notify pgrst, 'reload schema';
