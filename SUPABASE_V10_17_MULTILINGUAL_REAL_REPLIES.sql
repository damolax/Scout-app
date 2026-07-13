-- Scout v10.17: multilingual real-reply cleanup.
-- German/French/Spanish/Italian/Dutch auto acknowledgements should not count as Real Replies.
-- Human rejection/interest/detail-request replies still count as Real Replies.

alter table if exists public.reply_history add column if not exists updated_at timestamptz;
alter table if exists public.reply_history add column if not exists reply_bucket text;
alter table if exists public.reply_history add column if not exists is_real_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists is_auto_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists is_delivery_failure boolean not null default false;
alter table if exists public.reply_history add column if not exists is_blocked boolean not null default false;
alter table if exists public.reply_history add column if not exists is_limit_notice boolean not null default false;

-- Reset only classification flags. Keep every saved message.
update public.reply_history
set
  is_real_reply = false,
  is_auto_reply = false,
  is_delivery_failure = coalesce(is_delivery_failure, false),
  is_blocked = coalesce(is_blocked, false),
  is_limit_notice = coalesce(is_limit_notice, false),
  reply_bucket = coalesce(reply_bucket, 'review'),
  updated_at = now();

-- Delivery/bounce/limit messages: never count as replies.
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

-- Blocked/no-inbox messages: never count as replies.
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

-- Auto messages in several languages: receipts, support tickets, surveys, OOO, acknowledgements.
update public.reply_history
set
  is_real_reply = false,
  is_auto_reply = true,
  reply_bucket = 'auto_reply',
  updated_at = now()
where coalesce(is_delivery_failure, false) = false
  and coalesce(is_blocked, false) = false
  and lower(coalesce(from_email, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(snippet, '') || ' ' || coalesce(body, '')) like any (array[
    -- sender/headers/common platform markers
    '%noreply%', '%no-reply%', '%do-not-reply%', '%donotreply%', '%mailer-daemon%', '%postmaster%',
    '%zendesk%', '%reamaze%', '%freshdesk%', '%gorgias%', '%klaviyoservice%',
    -- English auto replies
    '%automatic reply%', '%automatic response%', '%auto:%', '%auto reply%', '%auto-reply%', '%autoreply%',
    '%out of office%', '%out-of-office%', '%currently out of office%', '%away from the office%', '%limited access to email%',
    '%this is an automated response%', '%this is an automated reply%', '%this is an automatic response%', '%automated notification%',
    '%this mailbox is not monitored%', '%this inbox is not monitored%', '%please do not reply%',
    '%your request has been received%', '%we have received your request%', '%we received your request%', '%received your request%',
    '%your message has been received%', '%we have received your message%', '%we received your message%', '%received your message%',
    '%request received%', '%ticket received%', '%case received%', '%ticket created%', '%case created%', '%has been created%',
    '%support ticket%', '%case number%', '%ticket number%', '%ticket id%', '%request #%',
    '%please type your reply above this line%', '%to add additional comments, reply to this email%',
    '%confirmation of receipt%', '%receipt of your email%', '%thank you for your recent email%', '%thanks for contacting support%',
    '%we will get back to you%', '%we will be in touch%', '%we’ll be in touch%', '%we will contact you shortly%',
    '%within 24 hours%', '%within 48 hours%', '%response time:%', '%feedback%', '%how satisfied%', '%rate our support%',
    -- German auto replies, translated meaning: received, ticket created, will respond, survey, waiting time
    '%automatische antwort%', '%automatische bestätigung%', '%automatische bestaetigung%', '%automatisch erzeugte%', '%automatisch verschickte%',
    '%eingangsbestätigung%', '%eingangsbestaetigung%', '%empfangsbestätigung%', '%empfangsbestaetigung%',
    '%anfrage eingegangen%', '%anfrage ist bei uns eingegangen%', '%ihre anfrage ist bei uns eingegangen%', '%deine anfrage ist bei uns eingegangen%',
    '%nachricht ist bei uns eingegangen%', '%ihre nachricht ist bei uns eingegangen%', '%deine nachricht ist bei uns eingegangen%',
    '%wir haben deine nachricht erhalten%', '%wir haben ihre nachricht erhalten%', '%wir haben ihre e-mail erhalten%', '%wir haben deine e-mail erhalten%',
    '%wir haben diese erhalten%', '%deine nachricht ist gut angekommen%', '%ihre nachricht ist gut angekommen%', '%nachricht hat uns erreicht%',
    '%vielen dank für ihre nachricht%', '%vielen dank für deine nachricht%', '%vielen dank für ihre e-mail%', '%vielen dank für deine e-mail%',
    '%vielen dank für die nachricht%', '%danke für ihre e-mail%', '%danke für deine e-mail%',
    '%anliegen wurde erstellt%', '%wurde erstellt%', '%ticketnummer%', '%ticket-nummer%', '%ticket empfangen%', '%ticket erstellt%',
    '%fallnummer%', '%vorgangsnummer%', '%referenznummer%', '%bearbeitungsnummer%',
    '%wir bearbeiten deine anfrage%', '%wir bearbeiten ihre anfrage%', '%wird nun von unserem team bearbeitet%', '%wird von unserem team bearbeitet%',
    '%wird bearbeitet%', '%bearbeitungszeit%', '%kundenservice%', '%support-team%',
    '%aktuell ein erhöhtes aufkommen%', '%erhöhtes aufkommen%', '%hohes aufkommen%', '%hohe anzahl%', '%bitten um geduld%',
    '%innerhalb von 24 stunden%', '%innerhalb von 48 stunden%', '%innerhalb der nächsten%', '%innerhalb der naechsten%',
    '%wir melden uns in kürze%', '%wir melden uns in kuerze%', '%wir melden uns schnellstmöglich%', '%wir melden uns schnellstmoeglich%',
    '%wir werden uns schnellstmöglich%', '%wir werden uns schnellstmoeglich%', '%schnellstmöglich bearbeiten%', '%schnellstmoeglich bearbeiten%',
    '%bitte antworten sie nicht%', '%bitte nicht antworten%', '%nicht beantwortet%', '%teilen sie uns ihr feedback mit%',
    '%zufriedenheit%', '%bearbeitung ihrer anfrage%', '%bearbeitung deiner anfrage%', '%bewerten sie%', '%zufriedenheitsumfrage%',
    -- French/Spanish/Italian/Dutch auto replies
    '%nous confirmons la réception%', '%nous avons reçu votre demande%', '%votre demande a été reçue%', '%merci de nous avoir contactés%', '%merci pour votre message%',
    '%hemos recibido%', '%su solicitud ha sido recibida%', '%gracias por contactarnos%', '%gracias por su mensaje%',
    '%abbiamo ricevuto%', '%la tua richiesta è stata ricevuta%', '%grazie per averci contattato%', '%grazie per il tuo messaggio%',
    '%wij hebben uw bericht ontvangen%', '%bedankt voor uw bericht%', '%uw aanvraag is ontvangen%'
  ]);

-- Human overrides in several languages. These are real because a person is making a decision, asking for detail, or reacting.
update public.reply_history
set
  is_real_reply = true,
  is_auto_reply = false,
  reply_bucket = 'real_reply',
  updated_at = now()
where coalesce(is_delivery_failure, false) = false
  and coalesce(is_blocked, false) = false
  and coalesce(is_limit_notice, false) = false
  and lower(coalesce(from_email, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(snippet, '') || ' ' || coalesce(body, '')) like any (array[
    -- English
    '%we don''t need%', '%we do not need%', '%not interested%', '%not looking for%', '%we are not looking%',
    '%we appreciate your insight%', '%thanks for sharing%', '%thank you for sharing%', '%please send%', '%can you send%', '%could you send%',
    '%send more details%', '%tell me more%', '%book a call%', '%schedule a call%', '%we would be interested%', '%sounds interesting%',
    '%your email itself is%', '%highly unprofessional%', '%no thank you%', '%no thanks%', '%remove us%', '%stop emailing%',
    -- German human replies
    '%kein interesse%', '%nicht interessiert%', '%haben kein interesse%', '%wir haben kein interesse%', '%kein bedarf%',
    '%wir haben keinen bedarf%', '%brauchen wir nicht%', '%benötigen wir nicht%', '%wir brauchen das nicht%', '%wir benötigen das nicht%',
    '%nicht auf der suche%', '%wir sind nicht auf der suche%', '%kommt für uns nicht in frage%', '%nicht relevant%',
    '%bitte senden sie%', '%bitte schick%', '%schicken sie%', '%senden sie%', '%können sie uns%', '%koennen sie uns%', '%könnt ihr uns%', '%koennt ihr uns%',
    '%bitte um weitere informationen%', '%weitere informationen%', '%mehr informationen%', '%angebot senden%', '%termin vereinbaren%',
    '%telefonat%', '%rufen sie%', '%lassen sie uns sprechen%', '%lass uns sprechen%', '%unprofessionell%', '%ihre e-mail%', '%deine e-mail%', '%vorschlag%',
    -- French/Spanish/Italian/Dutch human replies
    '%pas intéressé%', '%pas interesse%', '%nous ne sommes pas intéressés%', '%nous ne sommes pas interesses%', '%nous n’avons pas besoin%', '%nous n''avons pas besoin%',
    '%envoyez%', '%pouvez-vous envoyer%', '%plus de détails%', '%plus de details%', '%prendre rendez-vous%',
    '%no estamos interesados%', '%no nos interesa%', '%puede enviar%', '%más detalles%', '%mas detalles%',
    '%non siamo interessati%', '%non ci interessa%', '%può inviare%', '%puoi inviare%', '%maggiori dettagli%',
    '%niet geïnteresseerd%', '%niet geinteresseerd%', '%geen interesse%', '%kunt u sturen%', '%meer informatie%'
  ]);

-- Remaining matched clean inbound messages are treated as real replies.
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
