# Scout App v10.29 — Private Accounts + Follow-up 1000

## Fixed follow-up sending
- Follow-up list now loads up to 1,000 due follow-ups.
- Send Due Follow-ups Now can send up to 1,000 at once, controlled by the Send limit field.
- The follow-up preview list can show up to 1,000 rows.

## Fixed account separation
- New signups no longer enter the admin/shared workspace.
- Every non-admin signup gets a fresh private Scout workspace.
- Their uploads, Gmail accounts, templates, sent messages, replies, scouting level, and dashboard start from zero.
- The admin remains `oyekunleolalekan3168@gmail.com`.
- Admin setup values like app URL / Render URL / extension settings are copied to new private workspaces, but private data is not copied.

## Admin notification
- When a new user signs up, Scout creates an in-app notification in the admin workspace.

## Required SQL
Run:

`SUPABASE_V10_29_PRIVATE_WORKSPACES.sql`

This also repairs existing users that were previously sharing the admin workspace by moving them into their own blank private workspace and removing their access to the admin workspace.
