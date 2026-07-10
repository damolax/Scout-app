# What the reply numbers mean

Example:

```text
Sent Tracked: 1,000
Real Replies: 72
Auto Replies: 15
No Inbox / Blocked: 240
```

Before v8.32, `Sent Tracked` on the Replies page came from the last 1,000 loaded `sent_messages` rows. That was a UI cap, not necessarily your full database total.

In v8.32, `Sent Tracked` uses an exact database count, so it tracks all Gmail-accepted sent messages saved by Scout, not only the latest 1,000.

`Real Replies: 72` means Scout found 72 inbound Gmail messages that matched a sent message and were classified as human replies. These move the business to Responded.

`Auto Replies: 15` means out-of-office / vacation / automated replies. They are tracked, but they do not count as human replies.

`No Inbox / Blocked: 240` means Scout detected address-not-found, bounce, mailbox failure, blocked, or similar delivery failure notices. These do not count as real replies.

Gmail API does not always give a perfect “delivered to inbox” event. Scout therefore tracks:

```text
Gmail accepted send → Sent Tracked
Later failure notice → No Inbox / Blocked
Later auto response → Auto Reply
Later human response → Real Reply
```
