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
