# Scout App v8.7 — Reply Tracking + Import Email Fix

## Import fix

v8.7 improves CSV import detection so email fields are no longer missed just because the file uses names such as:

- Emails
- Found Emails
- Contact Emails
- Personal Email
- Business Email
- Owner Email
- Primary Email
- Verified Emails

It also scans every cell for normal and lightly obfuscated emails such as `info @ domain.com` and `info [at] domain [dot] com`.

The Upload page now shows how many rows in the full file have emails, even if the first 25 preview rows do not.

## Reply tracking

v8.7 adds a native Replies page that can sync selected Gmail accounts through the backend and separate:

- real prospect replies
- no-inbox / bounce / mailer-daemon results
- Gmail limit notices
- auto replies / out-of-office messages

Only real prospect replies count as responses.

## Performance tracking

The Replies page tracks:

- emails sent
- real replies
- emails sent per response
- template performance
- sender performance
- no-inbox signals

## Important

The frontend uses `/api/backend/...` as a proxy. The Render backend still needs working reply-reading endpoints. v8.7 tries these compatible endpoints:

- `/message/check-replies`
- `/replies/sync`
- `/gmail/replies`
