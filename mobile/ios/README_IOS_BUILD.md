# Scout iOS version

This is the iOS WebView source wrapper for Scout.

It opens:

https://scout-app-oyeola.vercel.app/message

It also supports iOS local schedule reminders. When you click **Add phone reminder** inside the iOS wrapper, Scout sends the reminder data to the native app and iOS schedules a top notification.

## Important limitation

I cannot produce an installable IPA here because iOS device builds require a Mac, Xcode, an Apple Developer account, a signing certificate, and a provisioning profile.

## Build steps

1. Open Xcode on a Mac.
2. Create a new iOS App project named `Scout`.
3. Replace the generated Swift files with the files inside `mobile/ios/ScoutWebView/Scout`.
4. Set your Bundle Identifier, for example `com.oyeola.scout`.
5. Select your Apple Developer Team under Signing & Capabilities.
6. Build to your iPhone or archive for TestFlight/App Store.

## Notification note

The iOS wrapper uses local notifications for Scout schedule reminders. The user must allow notifications when the app asks.
