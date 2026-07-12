# Scout Android APK

This folder contains the native Android WebView wrapper for Scout.

It opens:

https://scout-app-oyeola.vercel.app/message

It also includes Android top-of-phone local reminders for saved Scout schedules. When you click **Add phone reminder** inside the APK, Scout calls the native bridge and Android schedules a notification.

## Best build method: release APK from GitHub Actions

After pushing this package to GitHub:

1. Open your GitHub repo.
2. Go to **Actions**.
3. Open **Build Android APK**.
4. Click **Run workflow**.
5. Wait for the green check.
6. Open the run.
7. Scroll to **Artifacts**.
8. Download:

`scout-android-release-apk`

Inside it, install:

`scout-release-v10.3.apk`

This is the release APK. Use this instead of `app-debug.apk`.

## Why release APK is better

The old `app-debug.apk` can trigger Play Protect because it is debug-signed. This workflow now builds a release-signed APK.

If you do not set GitHub signing secrets, the workflow generates a temporary release key. That is fine for a first install, but future updates may require uninstalling the old APK first.

For stable updates, add these GitHub Secrets later:

- `SCOUT_ANDROID_KEYSTORE_BASE64`
- `SCOUT_ANDROID_KEYSTORE_PASSWORD`
- `SCOUT_ANDROID_KEY_ALIAS`
- `SCOUT_ANDROID_KEY_PASSWORD`

## Notification note

On Android 13+, the app will ask for notification permission. You must allow it for top-of-phone schedule reminders.
