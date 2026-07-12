# Scout v10.1 — Country-only targeting + mobile wrapper package

## Changed

- Location filter now shows countries only.
- It no longer shows exact addresses in the Send Emails country dropdown.
- Scout still scans uploaded fields like country, location, city, region, market, address, and raw CSV fields, but it extracts the country before showing it.
- Schedule sending uses the same country-only filter.
- Added native bridge support for Android/iOS wrappers so the Add phone reminder button can save a top-of-phone local reminder inside the mobile app.
- Added Android wrapper source under `mobile/android`.
- Added GitHub Actions workflow to build a debug APK.
- Added iOS wrapper Swift source under `mobile/ios`.

## Not changed

- Send Now remains direct.
- Auto Scout remains app-run.
- Schedules remain open-app runner + manual Run Due Sends Now.
- No cron dependency was added back.
