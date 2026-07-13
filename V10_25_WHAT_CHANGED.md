# Scout v10.25 — Automatic In-App Reply Sync

This version makes Scout check Gmail automatically when the app opens, refreshes, or becomes active again.

## What changed

- Scout now silently syncs inbound Gmail messages when the app opens.
- Scout syncs again when you return to the app/tab.
- The sync checks replies, auto replies, bounces, no-inbox messages, blocked notices, and Gmail limit notices.
- New important inbound activity creates normal Scout bell notifications.
- The notification bell refreshes immediately after automatic sync.
- Manual `Sync replies + bounces` is still available on the Replies page for a deeper check.

## Important note

This is in-app notification syncing. It does not require external phone push notification.
