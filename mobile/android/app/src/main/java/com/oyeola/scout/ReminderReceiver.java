package com.oyeola.scout;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                0,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, MainActivity.CHANNEL_ID)
                : new Notification.Builder(context);

        builder.setContentTitle(title != null && !title.isEmpty() ? title : "Scout schedule is due")
                .setContentText(body != null && !body.isEmpty() ? body : "Open Scout and run due sends.")
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setPriority(Notification.PRIORITY_HIGH);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify((int) System.currentTimeMillis(), builder.build());
    }
}
