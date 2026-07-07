# Scout App v8.13 Setup

Deploy normally, then run the SQL migration in Supabase if needed.

Recommended workflow:
1. Upload contacts. Rows with emails become Ready; rows without emails remain Pending.
2. Businesses page: queue no-email businesses to Auto Scout or open one business to inspect details.
3. Auto Scout: click Queue Pending No-Email, then Start Auto Scout.
4. Auto Scout now tries the backend first. If the backend result is missing/weak, the Node app deep-scans the business website.
5. Found emails are only promoted when they pass strict rules and have source evidence or safe domain match.
6. Ready Email Detection: run free preflight checks for format/disposable domains.
7. Email Scout: send only Ready contacts.
8. Replies / No Inbox: bounces/no-inbox do not count as responses.

Important: v8.13 improves website discovery, but speed still depends on target websites, blocking, timeouts, and backend/Vercel limits.
