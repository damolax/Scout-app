-- Scout v10.14: make old reply rows use one real-reply/auto-reply meaning.
-- Run after deploying v10.14, then click Replies -> Sync replies + bounces.

alter table if exists public.reply_history add column if not exists is_auto_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists is_real_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists reply_bucket text;
alter table if exists public.reply_history add column if not exists classification text;

-- Strong auto/ticket/receipt/feedback patterns should not count as real replies.
update public.reply_history
set is_real_reply = false,
    is_auto_reply = true,
    reply_bucket = 'auto_reply',
    classification = 'auto_reply'
where workspace_id is not null
  and (
    lower(coalesce(from_email,'') || ' ' || coalesce(subject,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body,'')) similar to
    '%(automatic reply|automatic response|automatische antwort|auto-reply|auto reply|out of office|ooo|vacation responder|this is an automated|do not reply|no-reply|noreply|request received|ticket received|case received|ticket created|case created|ticket number|ticket id|case number|please type your reply above this line|delivered by zendesk|zendesk|reamaze|freshdesk|gorgias|confirmation of receipt|thank you for your recent email|we have received your message|we received your message|received your message|we have received your request|we received your request|received your request|we will be in touch|we will contact you shortly|within 24 hours|within 48 hours|eingangsbestätigung|empfangsbestätigung|anfrage eingegangen|anfrage ist bei uns eingegangen|vielen dank für ihre nachricht|vielen dank für deine nachricht|wir haben deine nachricht erhalten|wir haben ihre nachricht erhalten|ticketnummer|teilen sie uns ihr feedback mit|zufriedenheit|bearbeitung ihrer anfrage|bearbeitung deiner anfrage)%'
    or lower(coalesce(from_email,'')) similar to '%(noreply|no-reply|donotreply|do-not-reply)%'
  );

-- Strong human/prospect patterns should count as real replies even if they are negative.
update public.reply_history
set is_real_reply = true,
    is_auto_reply = false,
    reply_bucket = 'real_reply',
    classification = 'real_reply'
where workspace_id is not null
  and (
    lower(coalesce(subject,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body,'')) similar to
    '%(we don''t need|we do not need|we dont need|not interested|not looking to|not looking for|we are not looking|we appreciate your insight|appreciate your insight|thank you for reaching out and sharing|thanks for sharing|thank you for sharing|your email itself is|highly unprofessional|please send|can you send|could you send|send more details|tell me more|book a call|schedule a call|no thank you|no thanks|wrong person|not the right person|forwarded this to|what is the cost|pricing|not for us|not a fit|we have an agency)%'
  );

-- A Re/AW subject alone is only a weak signal. Promote it only if the body is not a known auto/ticket notice.
update public.reply_history
set is_real_reply = true,
    is_auto_reply = false,
    reply_bucket = 'real_reply',
    classification = 'real_reply'
where workspace_id is not null
  and coalesce(is_auto_reply,false) = false
  and coalesce(is_delivery_failure,false) = false
  and (subject ~* '^\s*(re|aw|sv|antw|ré):')
  and lower(coalesce(subject,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body,'')) not similar to
    '%(automatic reply|automatic response|automatische antwort|request received|ticket received|case received|ticket created|case created|ticket number|ticket id|case number|confirmation of receipt|we have received your message|received your message|we have received your request|received your request|eingangsbestätigung|empfangsbestätigung|anfrage eingegangen|vielen dank für ihre nachricht|vielen dank für deine nachricht|teilen sie uns ihr feedback mit|zufriedenheit)%';

notify pgrst, 'reload schema';
