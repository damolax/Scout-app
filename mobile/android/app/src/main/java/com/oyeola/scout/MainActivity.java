package com.oyeola.scout;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

public class MainActivity extends android.app.Activity {
    static final String CHANNEL_ID = "scout_schedule_reminders";
    static final String SCOUT_URL = "https://scout-app-oyeola.vercel.app/message";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();
        requestNotificationPermissionIfNeeded();
        setupWebView();
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void setupWebView() {
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && (url.startsWith("mailto:") || url.startsWith("tel:"))) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    return true;
                }
                return false;
            }
        });
        webView.addJavascriptInterface(new ScoutNativeBridge(this), "ScoutNative");
        setContentView(webView);
        webView.loadUrl(SCOUT_URL);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Scout schedule reminders",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Alerts when a Scout schedule is due.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    public static class ScoutNativeBridge {
        private final Context context;
        ScoutNativeBridge(Context context) { this.context = context; }

        @JavascriptInterface
        public void scheduleReminder(String payloadJson) {
            try {
                JSONObject payload = new JSONObject(payloadJson);
                String id = payload.optString("id", String.valueOf(System.currentTimeMillis()));
                String title = payload.optString("title", "Scout schedule is due");
                String body = payload.optString("body", "Open Scout and run due sends.");
                String url = payload.optString("url", SCOUT_URL);
                long triggerAt = payload.optLong("triggerAt", System.currentTimeMillis() + 60000);

                Intent intent = new Intent(context, ReminderReceiver.class);
                intent.putExtra("title", title);
                intent.putExtra("body", body);
                intent.putExtra("url", url);

                int requestCode = Math.abs(id.hashCode());
                PendingIntent pendingIntent = PendingIntent.getBroadcast(
                        context,
                        requestCode,
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );

                AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
                if (alarmManager != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
                    } else {
                        alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
                    }
                }
                Toast.makeText(context, "Scout phone reminder saved", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(context, "Could not save Scout reminder: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }
}
