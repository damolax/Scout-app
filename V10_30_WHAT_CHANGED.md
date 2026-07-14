# Scout v10.30 — Team Duplicate Guard + Admin Dashboard + Password Reset

## What changed

- New accounts still get private workspaces and start from zero.
- Leads, templates, Gmail accounts, replies, levels, and dashboards remain private per account.
- Team duplicate guard now blocks prospects already scouted by another team account.
- CSV uploads, Source Scout imports, and extension imports remove team duplicates before they reach Auto Scout.
- Users get a Scout bell notification such as: “150 leads already scouted by a team member and removed from this upload.”
- Added admin-only Team Dashboard for `oyekunleolalekan3168@gmail.com`.
- Team Dashboard shows lifetime sent totals per user/workspace and per Gmail sender.
- Admin setup/settings are visible only to the main admin.
- Other users still receive the app/backend/extension setup values automatically, but cannot edit team setup.
- Signup flow no longer dumps confusing `[]`-style responses. If confirmation is required, it tells the user to check email. If confirmation is not required, it opens the private workspace.
- Added Forgot Password with confirmation. Users enter email, receive a reset link, then create and confirm a new password.

## SQL required

Run:

```text
SUPABASE_V10_30_TEAM_DUPLICATE_GUARD_ADMIN_DASHBOARD.sql
```
