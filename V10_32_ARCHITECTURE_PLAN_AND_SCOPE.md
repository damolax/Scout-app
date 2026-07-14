# Scout v10.32 — Architecture Plan and Locked Scope

## Baseline

Scout v10.32 was rebuilt from the user-supplied original `Scout v10.30.0` ZIP (`v1030work`). It was not built on top of the later workspace-provisioning experiments.

## Requirements implemented

1. Keep the original private-workspace architecture.
2. Fix `Cannot coerce the result to a single JSON object` without creating or repairing workspaces during page loads.
3. Ask for Full name only on Create Account.
4. Save Full name in Supabase Auth metadata and show it only in the admin Team Dashboard.
5. Fix password-reset redirects and reset-session handling.
6. Keep team-wide lead ownership: the first workspace to claim any stable business identity owns it.
7. Block team-owned leads during imports and immediately before sending.
8. Improve CSV upload reliability with bounded chunks, retries, session refresh and safe chunk splitting.
9. Stabilize the Messages page with paged reads and saved/durable send jobs.
10. Keep Daily safe limit at 450 and Default max/run at 50 when fields/database values are blank.
11. Make Settings limit inputs wide enough to show full numbers.
12. Make Businesses and Messages use the same country resolver and the full signed-in workspace list.
13. Keep English as the master template.
14. Add German, Spanish, French, Italian and Portuguese (Portugal) versions inside the same template record.
15. For each template, let the user explicitly assign countries from that workspace’s detected country list to English or a translated language.
16. Use explicit template country assignments before automatic language hints; use English if an assigned translation is incomplete.

## Explicitly not implemented

- No automatic workspace provisioning during page loads.
- No account-repair RPC.
- No new profiles.full_name requirement.
- No separate template row for every language.
- No replacement lead-ownership schema; the existing v10.30 registry is strengthened in place.
- No destructive cleanup of existing workspaces, members, leads, messages or templates.

## Language-selection order

For a selected template and business:

1. Explicit country assignment saved on that template.
2. Uploaded lead language, when supported.
3. Safe country mapping.
4. Strong country-domain mapping.
5. English fallback.

A country can be assigned to only one language within a template. English remains the fallback for unassigned countries.

## Database strategy

The included SQL is intentionally small. It:

- changes `app_notifications.entity_id` to text when necessary;
- restores the original signup trigger and makes the admin notification non-blocking;
- keeps Full name in Auth metadata;
- uses the existing v10.30 `team_scouted_leads` table;
- records email, genuine business domain, phone and the legacy normalized key as independent identities;
- ignores non-unique platform/free-provider domains such as Gmail, Facebook, LinkedIn and Yelp;
- recreates the category-aware import RPC with its expected return structure;
- adds an atomic BEFORE INSERT claim so simultaneous team uploads cannot both insert the same business.

It does not alter workspace membership records or perform a mass workspace repair.
