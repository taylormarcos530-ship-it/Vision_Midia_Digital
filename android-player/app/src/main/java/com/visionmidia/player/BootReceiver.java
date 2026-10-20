package com.visionmidia.player;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "VisionBoot";
    private static final String ACTION_QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON";
    private static final String ACTION_VENDOR_QUICKBOOT = "com.htc.intent.action.QUICKBOOT_POWERON";

    @Override
    public void onReceive(Context context, Intent intent) {
        final String action = intent == null ? "" : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !ACTION_QUICKBOOT.equals(action)
                && !ACTION_VENDOR_QUICKBOOT.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;

        boolean enabled = context.getSharedPreferences("vision_player_prefs", Context.MODE_PRIVATE)
                .getBoolean(MainActivity.KEY_AUTOSTART, true);
        if (!enabled) {
            Log.i(TAG, "Autostart disabled");
            return;
        }

        // Android 10+ may block background activity launches, even from boot broadcasts.
        // The overlay permission already used by kiosk return can allow this on some TV Boxes.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !Settings.canDrawOverlays(context)) {
            Log.w(TAG, "Boot launch may be blocked: overlay permission unavailable");
        }
        Intent launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            context.startActivity(launch);
            Log.i(TAG, "Boot launch requested: " + action);
        } catch (RuntimeException error) {
            Log.e(TAG, "Boot launch failed: " + action, error);
        }
    }
}
