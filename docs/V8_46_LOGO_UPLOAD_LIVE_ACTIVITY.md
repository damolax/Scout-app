# Scout App v8.46 — Logo Upload + Live Work Window

## Added
- Built-in signature logo upload in Settings.
- Uploads images to Supabase Storage bucket `email-assets`.
- Automatically fills the logo URL after upload.
- Logo is included in Scout-sent signatures and Gmail signature sync.
- Compact bottom-right Live Work window.
- Live Work shows active sending jobs, progress, recent sent emails, Auto Scout activity, and Stop for active send jobs.

## Notes
A Supabase bucket is a storage folder. Scout uses `email-assets` as a public bucket so Gmail and email recipients can load the logo image.

## Validation
- `npm run typecheck` passed.
- `npm run build` passed.
