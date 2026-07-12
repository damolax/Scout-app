# Scout App v10.2 — Signature Logo Dedup Fix

- Fixes duplicate logo in outgoing email signatures.
- Prevents Scout from appending Logo URL again when Signature HTML already contains an image/logo.
- Removes duplicate identical image tags at send time and while saving/syncing signatures.
- No SQL required.

Why it happened: older signature saves stored the logo inside `signature_html` and also kept `signature_logo_url`; the send builder then appended the same logo again.
