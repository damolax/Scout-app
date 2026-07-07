# Scout App v8.5 Setup

1. Push this package to GitHub.
2. Let Vercel deploy.
3. Run `supabase/migrations/202607050001_scout_v8_cloud.sql` again in Supabase SQL Editor.
4. Confirm `NEXT_PUBLIC_BACKEND_URL` is set in Vercel.
5. Open Verify Emails.
6. Click Refresh / Check verifier config.
7. Verify a small selected set first, then current page, then next batch.

Provider options:

- `basic_mx` works without a paid verifier key and checks format/MX/domain risk.
- Paid mailbox providers such as ZeroBounce, Hunter, Abstract, NeverBounce, and Kickbox require keys on the backend.


## v8.7 update

- Fixed CSV email detection for columns like Emails, Found Emails, Personal Email, Business Email, Owner Email, and Contact Emails.
- Upload preview now reports total detected email rows, so blank first-page preview rows do not mean the whole file has no emails.
- Added native Replies page for reply sync, no-inbox/bounce separation, and template/sender response tracking.
- Run the Supabase migration again after deploying v8.7.
