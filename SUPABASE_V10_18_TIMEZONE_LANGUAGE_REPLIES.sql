-- Scout v10.18: time-zone language auto-reply cleanup
-- Covers the current time-zone section target languages:
-- English (US/Canada), French (Canada/France), German (Germany), Spanish (Spain), plus Italian/Dutch extras.

alter table if exists public.reply_history add column if not exists updated_at timestamptz;
alter table if exists public.reply_history add column if not exists reply_bucket text;
alter table if exists public.reply_history add column if not exists is_real_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists is_auto_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists is_delivery_failure boolean not null default false;
alter table if exists public.reply_history add column if not exists is_blocked boolean not null default false;

with multilingual_auto as (
  select id
  from public.reply_history
  where coalesce(is_delivery_failure,false) = false
    and coalesce(is_blocked,false) = false
    and lower(coalesce(subject,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body,'')) like any (array[
      '%automatic reply%','%automatic response%','%out of office%','%your request has been received%',
      '%ticket created%','%ticket received%','%case created%','%request received%','%confirmation of receipt%',
      '%automatische antwort%','%eingangsbestätigung%','%empfangsbestätigung%','%anfrage eingegangen%',
      '%ihre anfrage ist bei uns eingegangen%','%deine anfrage ist bei uns eingegangen%',
      '%wir haben ihre nachricht erhalten%','%wir haben deine nachricht erhalten%','%ticketnummer%',
      '%teilen sie uns ihr feedback mit%','%bearbeitungszeit%','%wir melden uns schnellstmöglich%',
      '%réponse automatique%','%reponse automatique%','%absence du bureau%','%accusé de réception%',
      '%accuse de reception%','%confirmation de réception%','%confirmation de reception%',
      '%nous avons reçu votre message%','%nous avons reçu votre demande%','%votre demande a été reçue%',
      '%demande reçue%','%ticket créé%','%ticket cree%','%numéro de ticket%','%numero de ticket%',
      '%nous reviendrons vers vous%','%dans les plus brefs délais%','%merci de nous avoir contactés%',
      '%respuesta automática%','%respuesta automatica%','%fuera de la oficina%','%acuse de recibo%',
      '%hemos recibido su mensaje%','%hemos recibido tu mensaje%','%su solicitud ha sido recibida%',
      '%solicitud recibida%','%ticket creado%','%número de ticket%','%numero de ticket%',
      '%nos pondremos en contacto%','%lo antes posible%','%gracias por contactarnos%',
      '%risposta automatica%','%fuori ufficio%','%conferma di ricezione%','%abbiamo ricevuto il tuo messaggio%',
      '%abbiamo ricevuto la tua richiesta%','%richiesta ricevuta%','%ticket creato%','%numero di ticket%',
      '%grazie per averci contattato%',
      '%automatisch antwoord%','%automatische reactie%','%afwezigheidsbericht%',
      '%wij hebben uw bericht ontvangen%','%we hebben uw bericht ontvangen%','%uw aanvraag is ontvangen%',
      '%ticket aangemaakt%','%ticketnummer%','%zo snel mogelijk%','%binnen 24 uur%'
    ])
)
update public.reply_history r
set is_auto_reply = true,
    is_real_reply = false,
    reply_bucket = 'auto_reply',
    updated_at = now()
from multilingual_auto m
where r.id = m.id;

notify pgrst, 'reload schema';
