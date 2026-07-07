# v8.13 Auto Scout Deep Website Finder

Auto Scout now has a Node-side fallback finder. If the old backend gives a bad `@` match, no email, or a generated-only email, the app checks the business website directly.

Search depth:
- Homepage
- Contact / contact-us
- About / about-us
- Team / staff
- Support / service
- Impressum / imprint
- Privacy / legal / terms
- Mailto links
- Cloudflare encoded emails when present
- Obfuscated text such as `name [at] domain [dot] com`

Trust behavior:
- Bad fragments and assets are rejected.
- Source-seen emails are promoted.
- Domain-matching emails are promoted if not generated.
- Weak candidates are saved for Review, not treated as Ready.
- Inbox existence is confirmed only after sending/no-inbox bounce tracking.
