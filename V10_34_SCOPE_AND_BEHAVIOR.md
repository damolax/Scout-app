# Scout v10.34 — Sender speed and single-signature scope

This version is intentionally limited to the email sending engine.

## Confirmed behavior

- The delay field is measured in seconds in the Message page.
- The default is 3 seconds.
- The delay applies separately to each selected connected Gmail sender.
- Selected senders run in parallel.
- Each sender starts no more than one email inside its configured interval.
- Send Now, scheduled initial messages, and follow-ups use the same sender-lane engine.
- One sender reaching a Gmail limit pauses only that sender lane; other sender lanes continue.
- The saved job keeps progress between server invocations.
- While the app is open, the next job chunk starts promptly after the previous chunk finishes.

## Signature correction

The v10.33 scheduled-send path produced the signed plain-text body first and then passed it to the MIME builder, which appended the signature again to the HTML alternative. Gmail normally displays the HTML alternative, so the recipient could see the signature twice.

v10.34 makes the MIME builder the single owner of signature application:

- The sender passes the unsigned template body to the MIME builder.
- The MIME builder adds the signature once to text and once to HTML alternatives.
- The database history stores one signed text copy.
- The HTML builder also detects an already-present saved signature and does not append it again.

## Not changed

- Account creation
- Admin permissions
- Workspace access or RLS
- Supabase schema
- Templates and translation-country assignments
- Uploads
- Team duplicate ownership
- Gmail OAuth
- Reply classification

No SQL is required for v10.34.
