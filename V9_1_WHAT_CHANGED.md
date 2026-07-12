# Scout App v9.1 — Logo Upload Save Fix

Fixes the Settings logo/signature flow:

- Workspace loader now includes `email_signature_text`, `email_signature_html`, and `email_logo_url`.
- Uploaded logo public URL is displayed immediately in the Settings page.
- Added explicit `Public logo URL` field.
- Added `Copy URL` button.
- Added clear `Save signature & logo` button beside the URL field.
- Upload status/error is shown beside the upload control.
- Saving signature/logo now saves workspace defaults even if no Gmail account is connected yet.
- If Gmail accounts are connected, saving also applies the signature/logo to all sender accounts.
- Gmail sync button is still available after Gmail accounts are connected.
