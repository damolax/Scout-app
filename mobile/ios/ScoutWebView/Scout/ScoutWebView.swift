import SwiftUI
import WebKit
import UserNotifications

struct ScoutWebView: UIViewRepresentable {
    let url = URL(string: "https://scout-app-oyeola.vercel.app/message")!

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "ScoutNative")

        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "ScoutNative" else { return }
            guard let payload = message.body as? [String: Any] else { return }
            scheduleReminder(payload)
        }

        private func scheduleReminder(_ payload: [String: Any]) {
            let title = payload["title"] as? String ?? "Scout schedule is due"
            let body = payload["body"] as? String ?? "Open Scout and run due sends."
            let triggerAt = payload["triggerAt"] as? Double ?? Date().addingTimeInterval(60).timeIntervalSince1970 * 1000
            let seconds = max(60, (triggerAt / 1000) - Date().timeIntervalSince1970)

            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default

            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
            let request = UNNotificationRequest(identifier: payload["id"] as? String ?? UUID().uuidString, content: content, trigger: trigger)
            UNUserNotificationCenter.current().add(request)
        }
    }
}
