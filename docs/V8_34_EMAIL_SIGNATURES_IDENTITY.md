# Scout v8.34 - Email Signatures & Sender Identity

## What this version adds

- A new **Email Identity & Signatures** section in Settings.
- One shared signature can be saved across all connected Gmail sender accounts.
- Scout appends the signature automatically to:
  - initial outreach messages,
  - follow-up messages,
  - manual replies from the business conversation page.
- Optional HTML signature support.
- Optional sender profile picture URL storage for identity consistency inside Scout.
- Optional **Save + sync signature to Gmail** action.

## Important Gmail limitation

Scout can sync a Gmail web signature through the Gmail `sendAs` settings API only when the Gmail account has granted the Gmail settings scope. Existing accounts may need to reconnect Gmail after this version.

Scout cannot safely change each connected Google/Gmail profile picture through the normal Gmail OAuth flow. The app stores a profile picture URL for internal sender identity. Actual Google account profile photos must be changed manually in Google Account settings, or by a Workspace administrator using Admin SDK photo controls.

## Required migration

Run this in Supabase SQL Editor:

```sql
supabase/migrations/202607100834_email_signatures_identity.sql
```

## Deploy note

After deploying v8.34, reconnect Gmail if you want the **sync signature to Gmail** button to work. Scout-local signatures work immediately after the migration, without reconnecting Gmail.
