# Scout App v10.23 — Email Finder Test Panel

Auto Scout now has a clear diagnostic panel inside **Find Missing Emails**.

## Added

- **Test Email Finder** section on the Auto Scout page.
- **Test 1 website** button:
  - paste a website URL,
  - Scout checks Render connection,
  - Scout checks real website pages,
  - shows email found, pages checked, endpoint used, and whether it would be trusted,
  - does not save automatically.
- **Test 5 queued leads** button:
  - runs 5 real queued leads,
  - checks the full path: queue → Render/backend → website pages → decision → saved lead,
  - saves trusted emails to the actual leads.
- New API route: `/api/research/test-email-finder`.
- The test result shows:
  - Render reachable / not reachable,
  - endpoint that worked,
  - pages checked,
  - email found,
  - saved yes/no,
  - reason why it was trusted or rejected.

## Why

This makes Auto Scout problems visible immediately. You can now tell whether the issue is:

- Render is not configured,
- Render is not reachable,
- Render endpoint is failing,
- website pages are not being checked,
- email is found but rejected,
- email is found and saved correctly.
