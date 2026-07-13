# Scout App v10.24 — Auto Scout Simple One Button

Auto Scout was rebuilt around one clear process:

1. Use the website URL already saved on the lead.
2. Do not search by business name when a website exists.
3. Do not queue directory pages, social pages, IP addresses, or rows with only a business name.
4. Check the website first: homepage, contact, about, support, impressum, policies.
5. Use Render/backend only as a fast fallback, not something that can freeze the page.
6. Save only trusted emails.
7. Keep the Auto Scout page simple.

Removed from the main page:
- Test Email Finder panel.
- Test 1 website.
- Test 5 queued leads.
- Return queue to Need Emails.
- Delete invalid emails.
- Separate Add to queue / Start queue flow.

New page:
- Missing Emails
- Next Queue
- Checking Now
- Emails Saved
- One main button: Find emails now / Continue finding emails
- Stop after current group only while running
- Refresh
- Working now / next
- Emails saved
- Recent checks

Reliability fixes:
- Stuck running jobs are cleaned automatically.
- Stale running jobs no longer appear as fake “No email” results.
- Previously checked no-email leads can be queued again when the finder improves.
- Backend calls have strict timeouts.
- Website-first finder runs before backend fallback.
