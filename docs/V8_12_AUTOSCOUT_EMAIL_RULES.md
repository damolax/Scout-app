# v8.12 Auto Scout Email Rules

This update improves Auto Scout result quality.

## What changed

- Do not accept text just because it contains `@`.
- Extract complete email addresses only.
- Reject image/code asset strings such as `logo@2x.png`.
- Reject placeholder/test domains like `example.com`, `domain.com`, `company.com`.
- Reject non-contact mailboxes such as `noreply`, `postmaster`, `abuse`, `mailer-daemon`.
- Prefer source-seen emails with evidence URLs.
- Accept domain-match emails when they are not marked generated/guessed.
- Keep weak generated candidates in review instead of promoting them as found.

## Trust rule

Auto Scout can discover email candidates. It cannot honestly prove inbox delivery until sending/bounce tracking.
