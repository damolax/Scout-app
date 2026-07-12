# Scout v10.1 mobile build status

## Android

Android native wrapper source is included in `mobile/android`.

The repository also includes a GitHub Actions workflow:

`.github/workflows/build-android-apk.yml`

After pushing v10.1, go to GitHub Actions and run **Build Android APK**. The workflow builds a downloadable debug APK artifact.

## iOS

The iOS wrapper source is included in `mobile/ios`.

An installable iOS IPA cannot be produced without Apple signing on a Mac/Xcode environment. Use the files in `mobile/ios` to create the Xcode app and sign it with the client's Apple Developer account.

## Notifications

The web/PWA notification is still supported while Scout is open/active.

Inside the Android/iOS wrappers, the **Add phone reminder** button uses native local notifications for schedule reminders.
