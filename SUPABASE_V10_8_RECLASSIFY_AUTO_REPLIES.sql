-- Scout v10.8: reclassify automatic replies that were previously counted as real replies.
-- This fixes dashboard/challenge/reply counts for ticket confirmations, received-message notices,
-- out-of-office messages, feedback requests, and multilingual auto acknowledgements.

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
  '%automatic reply%',
  '%automatic response%',
  '%auto-reply%',
  '%auto reply%',
  '%autoreply%',
  '%out of office%',
  '%out-of-office%',
  '%vacation responder%',
  '%away from the office%',
  '%no-reply%',
  '%noreply%',
  '%do-not-reply%',
  '%please do not reply%',
  '%this is an automated%',
  '%automated response%',
  '%automated reply%',
  '%automated message%',
  '%automatic acknowledgement%',
  '%automated acknowledgement%',
  '%your request has been received%',
  '%we have received your request%',
  '%we have received your message%',
  '%we received your request%',
  '%we received your message%',
  '%we''ve received your request%',
  '%we''ve received your message%',
  '%request received%',
  '%ticket received%',
  '%case has been created%',
  '%ticket has been created%',
  '%support ticket has been created%',
  '%ticket number%',
  '%ticket id%',
  '%case number%',
  '%request #% ',
  '%being reviewed by our support staff%',
  '%delivered by zendesk%',
  '%please type your reply above this line%',
  '%to add additional comments, reply to this email%',
  '%thank you for your recent email%',
  '%thank you for contacting us%',
  '%thanks for contacting support%',
  '%we will be in touch%',
  '%we will contact you shortly%',
  '%within 24 hours%',
  '%within 48 hours%',
  '%automatische antwort%',
  '%automatisch erzeugte%',
  '%automatisch verschickte%',
  '%eingangsbestätigung%',
  '%empfangsbestätigung%',
  '%anfrage eingegangen%',
  '%anfrage ist bei uns eingegangen%',
  '%ihre anfrage ist bei uns eingegangen%',
  '%deine anfrage ist bei uns eingegangen%',
  '%ihre nachricht ist bei uns eingegangen%',
  '%deine nachricht ist bei uns eingegangen%',
  '%wir haben deine nachricht erhalten%',
  '%wir haben ihre nachricht erhalten%',
  '%vielen dank für ihre nachricht%',
  '%vielen dank für deine nachricht%',
  '%danke für deine nachricht%',
  '%ticketnummer%',
  '%ticket-nummer%',
  '%anliegen wurde erstellt%',
  '%teilen sie uns ihr feedback mit%',
  '%zufriedenheit%',
  '%bearbeitung ihrer anfrage%',
  '%bearbeitung deiner anfrage%',
  '%bearbeitungszeit%',
  '%schnellstmöglich%',
  '%nous confirmons la réception%',
  '%nous avons reçu votre demande%',
  '%votre demande a été reçue%',
  '%merci de nous avoir contactés%',
  '%hemos recibido%',
  '%su solicitud ha sido recibida%',
  '%abbiamo ricevuto%',
  '%la tua richiesta è stata ricevuta%'
])
and coalesce(is_delivery_failure, false) = false
and coalesce(is_blocked, false) = false
and coalesce(is_limit_notice, false) = false;

-- If a business was marked responded only because of an automatic reply, move it out of "real responded".
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='reply_state') then
    execute $sql$
      update public.businesses b
      set
        reply_state = 'auto_reply',
        status = case when b.status = 'responded' then 'contacted' else b.status end
      where exists (
        select 1 from public.reply_history r
        where r.business_id = b.id
          and r.workspace_id = b.workspace_id
          and (r.is_auto_reply = true or r.reply_bucket = 'auto_reply')
      )
      and not exists (
        select 1 from public.reply_history r
        where r.business_id = b.id
          and r.workspace_id = b.workspace_id
          and (r.is_real_reply = true or r.reply_bucket = 'real_reply' or r.classification = 'real_reply')
          and coalesce(r.is_auto_reply, false) = false
      )
    $sql$;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='last_auto_reply_at') then
    execute $sql$
      update public.businesses b
      set last_auto_reply_at = coalesce((
        select max(r.received_at)
        from public.reply_history r
        where r.business_id = b.id
          and r.workspace_id = b.workspace_id
          and (r.is_auto_reply = true or r.reply_bucket = 'auto_reply')
      ), b.last_auto_reply_at)
      where exists (
        select 1 from public.reply_history r
        where r.business_id = b.id
          and r.workspace_id = b.workspace_id
          and (r.is_auto_reply = true or r.reply_bucket = 'auto_reply')
      )
    $sql$;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='last_real_reply_at') then
    execute $sql$
      update public.businesses b
      set last_real_reply_at = null
      where not exists (
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
