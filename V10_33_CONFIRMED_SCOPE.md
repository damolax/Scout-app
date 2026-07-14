# Scout v10.33 confirmed scope

## Account access

- Create Account asks for Full name, Email, and Password.
- New users enter Scout immediately after normal Supabase email-confirmation rules are satisfied.
- There is no manual admin approval workflow.
- The legacy `approved` column remains only for compatibility and is always set to true.
- Every Auth user receives one private personal workspace.
- Existing workspaces and their businesses/messages/templates are preserved.

## Administrator

The only global administrator is:

`oyekunleolalekan3168@gmail.com`

Only this account can open Team Dashboard and admin-only controls.
All other profiles and workspace memberships use the `member` role.

## Name usage

- Full name is collected once during signup.
- It is stored in Auth metadata and `profiles.full_name`.
- Dashboard greets the user by first name.
- Team Dashboard shows the user's name and email.
- Name never controls permissions or workspace access.

## Team Dashboard

The admin sees:

- number of registered Auth users;
- name and email;
- registration date;
- total number of connected sender accounts;
- lifetime sent;
- total and ready leads;
- real replies;
- auto replies;
- no-inbox count.

Individual sender email addresses are not shown.

## Privacy and workspace security

- `is_workspace_member()` now verifies an explicit membership row.
- A signed-in user can read only their own workspace membership.
- All existing workspace RLS policies that call `is_workspace_member()` become private per workspace.
- `app_notifications` is restricted to the user's workspace.
- The global team duplicate registry is not directly readable by users.

## Preserved v10.32 features

The rebuild preserves the existing template translations, per-language country assignments, shared country normalization, durable message jobs, upload retry/chunking logic, settings defaults, and team-wide duplicate protection.
