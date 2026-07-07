# Scout Feature Parity

## Done

- [x] Native Node/Next/Supabase shell
- [x] Email/password login
- [x] Auto-approved users
- [x] Admin account support
- [x] Native upload/import foundation
- [x] 100,000-row import limit
- [x] Fast server-side chunk import
- [x] Duplicate skip against queue and scout history
- [x] Native business queue
- [x] Business search/filter/status updates
- [x] Bulk status updates and export

## Next

- [ ] Native Verify Email
- [ ] Native templates
- [ ] Native Gmail OAuth status/accounts UI
- [ ] Native batch sending
- [ ] Reply tracking
- [ ] No-inbox/bounce handling
- [ ] Extension/dorking flow
- [ ] Background email research worker
- [ ] Dashboard based on cloud data


## v8.5 Native Verify Email

- [x] Verify selected contacts with backend `/batch-verify-emails`
- [x] Verify current page
- [x] Verify next batch up to 500
- [x] Store verification result in Supabase
- [x] Move valid contacts to Ready
- [x] Move risky/catch-all/unknown to Review
- [x] Move invalid/no-MX/bad-format to Invalid
- [x] Save candidate verification records
- [x] Download last verification results
- [ ] Full background verification worker for 100k lists
