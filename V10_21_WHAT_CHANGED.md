# Scout v10.21 — Real Website Auto Scout Finder

This build fixes Auto Scout so it behaves like a real website email finder again.

## What changed

- Auto Scout still uses the Render email-finder backend when `NEXT_PUBLIC_BACKEND_URL` is set.
- Auto Scout no longer relies only on a backend guess.
- For every business with a website/domain, Scout now checks the real website pages:
  - home page
  - contact page
  - contact-us page
  - about page
  - team/staff page
  - support/customer-service page
  - impressum/imprint page
  - privacy/legal pages
  - Shopify `/pages/contact` and similar pages
  - German/French/Spanish/Italian contact page variants
- Scout picks the best main inbox, not just any email-looking text.
- Contact-page emails and useful inboxes like info, hello, contact, support, sales, orders, office, admin, b2b, wholesale get stronger priority.
- Scout decodes more hidden/obfuscated emails:
  - Cloudflare email protection
  - mailto links
  - JSON-LD email fields
  - data-email attributes
  - unicode escaped emails
- Auto Scout writes better live events showing pages checked and email found/no email.
- If no email is found after checking pages, Scout says that clearly instead of pretending it succeeded.

## No SQL required
