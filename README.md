# Scout App v8.13 Deep Website Finder

This version improves Auto Scout so it does not only depend on the backend returning an email. If the backend result is missing, weak, generated, or not trusted, the Node app now performs a deeper website search itself.

Key changes:
- Keeps the v8.12 strict email rules so bad `@` fragments are still rejected.
- Adds a server-side deep website finder inside the Node app.
- Checks homepage, likely contact/about/team/support/impressum/privacy/legal pages.
- Extracts `mailto:` links and visible page emails.
- Decodes common obfuscations like `info [at] domain [dot] com`.
- Decodes Cloudflare protected emails where the encoded value is present in the HTML.
- Saves source evidence URL and source type with the candidate.
- Promotes source-seen/domain-matching emails, keeps weak candidates in Review.
- Auto Scout live/results table now includes page evidence and pages checked.

This does not prove inbox delivery before sending. It proves the email was found from a source page. Real no-inbox/bounce confirmation still happens after sending and reply/bounce sync.

Run the Supabase migration after deployment if your project has not already been migrated through the prior v8 versions.
