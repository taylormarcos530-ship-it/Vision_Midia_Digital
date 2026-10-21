package com.visionmidia.player;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.os.SystemClock;
import android.os.Build;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "VisionBoot";

    public static final String ACTION_BOOT_RETRY = "com.visionmidia.player.BOOT_RETRY";
    public static final String KEY_BOOT_OPENED = "boot_activity_opened";
    private static final long[] RETRY_DELAYS_MS = { 8_000L, 25_000L, 60_000L };

    private void scheduleRetries(Context context) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) return;
        for (int i = 0; i < RETRY_DELAYS_MS.length; i++) {
            Intent retry = new Intent(context, BootReceiver.class);
            retry.setAction(ACTION_BOOT_RETRY);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pending = PendingIntent.getBroadcast(context, 15190 + i, retry, flags);
            alarm.set(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    SystemClock.elapsedRealtime() + RETRY_DELAYS_MS[i], pending);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        final String action = intent == null ? "" : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)
                && !"com.htc.intent.action.QUICKBOOT_POWERON".equals(action)
                && !ACTION_BOOT_RETRY.equals(action)) return;

        // Before the user unlocks Android, credential-protected preferences may be unavailable.
        // Do not launch an app that needs credential-protected WebView data at locked boot.
        if (Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)) {
            Log.i(TAG, "Locked boot received; waiting for normal boot completion");
            return;
        }

        try {
            android.content.SharedPreferences preferences = context.getSharedPreferences("vision_player_prefs", Context.MODE_PRIVATE);
            boolean enabled = preferences.getBoolean(MainActivity.KEY_AUTOSTART, true);
            if (!enabled) return;
            if (ACTION_BOOT_RETRY.equals(action)) {
                if (preferences.getBoolean(KEY_BOOT_OPENED, false)) return;
            } else {
                preferences.edit().putBoolean(KEY_BOOT_OPENED, false).apply();
                scheduleRetries(context);
            }
            Intent launch = new Intent(context, MainActivity.class);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(launch);
            Log.i(TAG, "Vision launch requested after " + action);
        } catch (Exception error) {
            Log.w(TAG, "Android blocked Vision auto-launch after " + action, error);
        }
    }
}
