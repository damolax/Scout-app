# Scout v10.3 — Release APK Builder

## Fixed

- Added a release APK build workflow.
- GitHub Actions now produces `scout-android-release-apk`.
- The final APK is named `scout-release-v10.3.apk`.
- Kept a debug APK as backup only.
- Release APK uses Android release signing instead of debug signing.
- Notification permission/reminder bridge remains included.

## Important

A sideloaded release APK can still show an unknown-app warning, but it is much better than a debug APK. For team/client distribution, Google Play Console internal testing is still the cleanest method.
