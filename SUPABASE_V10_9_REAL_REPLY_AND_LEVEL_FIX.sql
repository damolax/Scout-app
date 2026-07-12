-- Scout v10.9: make real replies more honest, without losing real human replies.
-- Run after deploying v10.9.

-- 1) Strong automatic/ticket/confirmation messages should not count as real replies.
update public.reply_history
set
  is_real_reply = false,
  is_auto_reply = true,
  classification = 'auto_reply',
  reply_bucket = 'auto_reply'
where lower(
  coalesce(from_email, '') || ' ' ||
  coalesce(subject, '') || ' ' ||
  coalesce(snippet, '') || ' ' ||
  coalesce(body, '') || ' ' ||
  coalesce(raw::text, '')
) like any (array[
  '%automatic reply%', '%automatic response%', '%automatische antwort%', '%auto-reply%', '%auto reply%', '%autoreply%',
  '%out of office%', '%out-of-office%', '%vacation responder%', '%away from the office%', '%no-reply%', '%noreply%', '%do-not-reply%',
  '%please do not reply%', '%this is an automated%', '%automated response%', '%automated reply%', '%automated message%',
  '%your request has been received%', '%we have received your request%', '%support ticket has been created%', '%ticket has been created%',
  '%request received%', '%ticket received%', '%case has been created%', '%ticket number%', '%ticket id%', '%case number%',
  '%being reviewed by our support staff%', '%delivered by zendesk%', '%please type your reply above this line%',
  '%to add additional comments, reply to this email%', '%thank you for your recent email%', '%we will be in touch%',
  '%we will contact you shortly%', '%within 24 hours%', '%within 48 hours%', '%eingangsbestätigung%', '%empfangsbestätigung%',
  '%anfrage eingegangen%', '%anfrage ist bei uns eingegangen%', '%ticketnummer%', '%ticket-nummer%', '%anliegen wurde erstellt%',
  '%teilen sie uns ihr feedback mit%', '%zufriedenheit%', '%bearbeitung ihrer anfrage%', '%bearbeitung deiner anfrage%', '%bearbeitungszeit%',
  '%nous confirmons la réception%', '%votre demande a été reçue%', '%hemos recibido%', '%su solicitud ha sido recibida%', '%la tua richiesta è stata ricevuta%'
])
and coalesce(is_delivery_failure, false) = false
and coalesce(is_blocked, false) = false
and coalesce(is_limit_notice, false) = false;

-- 2) Human reply override: some real replies include polite words, rejection, interest, or direct criticism.
-- These should count as real replies even if an older cleanup marked them automatic.
update public.reply_history
set
  is_real_reply = true,
  is_auto_reply = false,
  classification = 'real_reply',
  reply_bucket = 'real_reply'
where lower(
  coalesce(from_email, '') || ' ' ||
  coalesce(subject, '') || ' ' ||
  coalesce(snippet, '') || ' ' ||
  coalesce(body, '') || ' ' ||
  coalesce(raw::text, '')
) like any (array[
  '%we don''t need%', '%we do not need%', '%we are not interested%', '%not interested%', '%not looking to%', '%not looking for%',
  '%we are not looking%', '%we''re not looking%', '%we appreciate your%', '%appreciate your insight%', '%appreciate the insight%',
  '%thanks for sharing%', '%thank you for sharing%', '%thank you for reaching out and sharing%', '%we value thoughtful%',
  '%your email itself is%', '%highly unprofessional%', '%please send%', '%can you send%', '%could you send%', '%send more details%',
  '%tell me more%', '%book a call%', '%schedule a call%', '%let us talk%', '%let''s talk%', '%we would be interested%', '%sounds interesting%',
  '%we already have%', '%we are happy with%', '%this is not something%', '%no thank you%', '%no thanks%'
])
and coalesce(is_delivery_failure, false) = false
and coalesce(is_blocked, false) = false
and coalesce(is_limit_notice, false) = false;

-- 3) Refresh business reply state from the cleaned reply rows.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='reply_state') then
    execute $sql$
      update public.businesses b
      set
        status = 'responded',
        reply_state = 'real_reply',
        last_real_reply_at = coalesce((
          select max(r.received_at)
          from public.reply_history r
          where r.business_id = b.id
            and r.workspace_id = b.workspace_id
            and (r.is_real_reply = true or r.reply_bucket = 'real_reply' or r.classification = 'real_reply')
            and coalesce(r.is_auto_reply, false) = false
        ), b.last_real_reply_at)
      where exists (
        select 1 from public.reply_history r
        where r.business_id = b.id
          and r.workspace_id = b.workspace_id
          and (r.is_real_reply = true or r.reply_bucket = 'real_reply' or r.classification = 'real_reply')
          and coalesce(r.is_auto_reply, false) = false
      )
    $sql$;
  end if;
end $$;

notify pgrst, 'reload schema';
