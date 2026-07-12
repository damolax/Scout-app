# Scout Android APK

This is a native Android WebView wrapper for Scout.

It opens:

https://scout-app-oyeola.vercel.app/message

It also includes Android top-of-phone local reminders for saved Scout schedules. When you click **Add phone reminder** inside the APK, Scout calls the native bridge and Android schedules a notification.

## Fastest build method

After pushing this package to GitHub, open:

GitHub repo → Actions → Build Android APK → Run workflow

Then download the artifact:

`scout-android-debug-apk`

The APK file is:

`app-debug.apk`

## Manual Android Studio method

1. Open Android Studio.
2. Open the folder `mobile/android`.
3. Wait for Gradle sync.
4. Build → Build Bundle(s) / APK(s) → Build APK(s).
5. Install the generated debug APK on your phone.

## Important

On Android 13+, the app must ask for notification permission before top notifications are allowed.
