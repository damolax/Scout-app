# Scout App v8.5 Native Verify Email

This version keeps the real Node/Next/Supabase app and adds the native Verify Emails workflow. It does not embed the old v73 index app.

## Included

- v8.4 native business queue and fast import foundation
- Native Verify Emails page
- Backend verifier config check
- Verify selected contacts
- Verify current page
- Verify next batch, capped at 500 per run
- Saves verification result back into Supabase businesses.raw.verification
- Moves safe contacts to Ready
- Moves invalid contacts to Invalid
- Keeps risky/catch-all/unknown contacts in Review
- Upserts email candidate verification records
- Download last verification results as CSV

## Important

Run the Supabase migration again before testing because v8.5 adds unique/index support for email candidate verification upserts.


## v8.7 update

- Fixed CSV email detection for columns like Emails, Found Emails, Personal Email, Business Email, Owner Email, and Contact Emails.
- Upload preview now reports total detected email rows, so blank first-page preview rows do not mean the whole file has no emails.
- Added native Replies page for reply sync, no-inbox/bounce separation, and template/sender response tracking.
- Run the Supabase migration again after deploying v8.7.
