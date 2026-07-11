# Scout v8.40 — Controlled Sending Operations

This build simplifies Operations Autopilot and adds safer sending controls.

## New controls

- **Due schedules at once**: how many scheduled jobs the worker opens in one run.
- **Emails to send at once**: maximum contacts each schedule can process in this run.
- **Max per sender this run**: maximum emails each Gmail sender can send during this run.
- **Inbox messages per sender**: how many Gmail inbox messages are scanned per sender when syncing replies/bounces.
- **Auto Scout cycles**: how many research passes Auto Scout runs.

## Sender safety

Scheduled sending now respects both:

1. The per-run sender cap chosen in Operations.
2. The Gmail account daily limit minus what the account has already sent today.

This means if a sender has a daily cap of 450 and has already sent 430, a worker run can only use up to 20 more emails from that sender.

## Sender Health

The Sender Health table now shows exact sent messages from the last 24 hours by reading `sent_messages`, instead of only trusting the stored `sent_today` field.
