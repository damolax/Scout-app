# Scout v10.35 — Safe Sending & Google Verification

Baseline: the supplied working Scout v10.34 package.

## Normal use stays simple

Users keep the same core flow:

1. Connect Gmail.
2. Choose a template and recipients.
3. Send now or schedule.

Scout applies pacing, limits, duplicate protection, suppression, and sender-capacity checks in the background. A user sees a warning only when something needs attention.

## Gmail authorization in this release

New Gmail connections request only:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.send`

Automatic Gmail reply reading and Gmail-native signature editing remain in the codebase but are disabled with feature flags during the first Google verification submission.

- Existing reply history remains visible in Scout.
- New replies are read and answered in Gmail for now.
- A Scout signature is still appended exactly once to messages sent from Scout.
- Users can copy the Scout signature into Gmail manually.

## Sending safety

Each Gmail account keeps its own daily maximum and maximum per explicit run. Server-side reservations prevent overlapping jobs from exceeding the same sender allowance.

Scout displays **Sent today** using the workspace timezone and separately enforces a rolling 24-hour safety count in the background.

Sending modes:

- **Warm-up / Recovery:** randomized 60–180 second pacing and a gradual daily allowance.
- **Normal:** randomized 15–45 second pacing; recommended for everyday use.
- **Fast:** the existing 3-second lane, available only after the sender is marked healthy.

Background sending is limited to a configurable number of active sender lanes. Default: 8.

## Deliverability precautions

- Sender health and placement-test results
- Spam-risk warnings without silently rewriting content
- Gmail provider-limit pauses
- Permanent invalid-address and unsubscribe suppression
- Team-wide duplicate ownership
- Controlled one-message seed placement tests
- Custom-domain authentication guidance

These precautions reduce avoidable risk but do not guarantee inbox placement.

## Management improvements

- Team page: server-side search and 20 users per page
- Replies: existing real/automatic/delivery history remains searchable and paginated
- Template-health warning after the configured evidence threshold
- Account deletion requires exact `DELETE`
- Deleted users' personal data is removed while anonymous lead fingerprints remain for team duplicate prevention

## Preserved systems

This release does not redesign:

- signup or workspace provisioning
- admin identity or approval behavior
- workspace roles or RLS
- upload architecture
- country assignment or translation logic
- lead ownership rules
- existing businesses, templates, Gmail connections, sent history, or reply history

## Feature flags for the first deployment

```env
GMAIL_SEND_ENABLED=true
GMAIL_REPLY_SYNC_ENABLED=false
GMAIL_NATIVE_SIGNATURE_SYNC_ENABLED=false
DELIVERABILITY_CENTER_ENABLED=true
SENDER_HEALTH_ENFORCEMENT_ENABLED=true
PLACEMENT_TESTS_ENABLED=true
TEAM_PAGINATION_ENABLED=true
ACCOUNT_DELETION_ENABLED=true
SCOUT_MAX_ACTIVE_SENDER_LANES=8
```
