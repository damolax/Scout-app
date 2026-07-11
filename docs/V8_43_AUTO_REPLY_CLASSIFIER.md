# Scout v8.43 — Auto Reply Classifier

This patch strengthens the inbound Gmail classifier so automatic replies are less likely to be counted as real human replies.

## Added signals

Scout now checks both Gmail headers and message text for auto-reply patterns, including:

- Auto-Submitted / X-Autoreply / X-Autorespond headers
- Out-of-office / away / vacation responder language
- Automated response / automatic reply / system-generated message language
- Do-not-reply / no-reply / unmonitored mailbox signals
- Ticket acknowledgement and support auto-confirmation language

## Why

A real reply should be a human response to the outreach. An auto reply is still an inbound email, but it should not increase response-rate analytics as a human response.
