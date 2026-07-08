# Scout App v8.17

## v8.17 focus

Auto Scout duplicate-email guard.

This version keeps v8.16 strict email filtering and adds a second protection layer:

- blocks one exact email from being promoted across unrelated businesses;
- quarantines suspicious repeated emails already stored in the database;
- keeps those businesses available for re-scouting instead of marking them Ready;
- adds an Auto Scout button: **Clean Repeated Emails**;
- stores the reason in `raw.repeated_email_guard` for audit.

This is important because bad crawlers can scrape the same widget/captcha/script email-like string from many unrelated sites. Scout must not treat that as a real business inbox.
