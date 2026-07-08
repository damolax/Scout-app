# v8.17 Auto Scout Duplicate Guard

## Problem fixed

Some website pages contain shared widget, captcha, CDN, or script text that can look like an email. If that same text appears across many unrelated websites, Auto Scout must not promote it as a contact email.

## New behavior

- If the same exact email is attached to multiple unrelated business domains, Scout treats it as suspicious.
- Suspicious repeated emails are not promoted to Ready.
- Existing repeated false positives can be cleaned from the Auto Scout page.
- Cleaned businesses are moved back to Review and can be re-scouted.
- Details are stored in `raw.repeated_email_guard`.

## Button added

Auto Scout → Clean Repeated Emails

## Route added

`POST /api/research/quarantine-repeated-emails`

Payload:

```json
{
  "workspaceId": "workspace-id",
  "limit": 50000
}
```

## Trust rule

Domain-matched/source-backed emails are preferred. A real inbox is still confirmed only after sending and bounce/no-inbox tracking.
