# v8.28 — Deliverability Dashboard + Auto Scout Worker

## Added

- New `/deliverability` page.
- Sender risk table by Gmail account.
- 7-day sent volume, no-inbox/bounce rate, blocked count, real replies, auto replies, Gmail limit notices, and seed inbox spam placement.
- New `/api/research/run-worker` route.
- Auto Scout page now has **Run Server Worker**.
- Worker queues pending/no-email businesses, resets stale running research jobs, then runs several backend batches server-side.
- `/api/research/run-once` now supports `workspaceId` filtering so one workspace worker does not steal queued jobs from another workspace.

## Why

Auto Scout should not require the browser to manually keep looping forever. The worker gives the app a backend-style runner while still using the existing Render email finder and internal deep website finder.

## Important

Render is still used when `NEXT_PUBLIC_BACKEND_URL` points to the Render backend.
