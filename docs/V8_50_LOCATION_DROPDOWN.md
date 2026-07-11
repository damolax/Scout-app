# Scout App v8.50 — Uploaded Location Dropdown

This build changes the Send Emails location filter from free typing to a dropdown.

## Why

The location used for Send Now and Schedule should come only from the uploaded lead list. This prevents typos such as `Untied States` or a location that does not exist in the database.

## What changed

- The Send Emails page now shows **Location from uploaded list**.
- The dropdown is built from Ready leads that already have an email and a location.
- Each option shows the number of Ready leads found for that location.
- Send Now uses exact location matching.
- Schedule stores the exact selected uploaded location in `raw.location_filter`.
- Cron/schedule worker uses exact location matching for new schedules.
- Old schedules with only `country_filter` still work using the old flexible match.

## No SQL required

This is a code-only fix. The selected location is stored inside the existing `message_schedules.raw` JSON field.
