package com.visionmidia.player;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "VisionBoot";

    @Override
    public void onReceive(Context context, Intent intent) {
        final String action = intent == null ? "" : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)
                && !"com.htc.intent.action.QUICKBOOT_POWERON".equals(action)) return;

        // Before the user unlocks Android, credential-protected preferences may be unavailable.
        // Do not launch an app that needs credential-protected WebView data at locked boot.
        if (Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)) {
            Log.i(TAG, "Locked boot received; waiting for normal boot completion");
            return;
        }

        try {
            boolean enabled = context.getSharedPreferences("vision_player_prefs", Context.MODE_PRIVATE)
                    .getBoolean(MainActivity.KEY_AUTOSTART, true);
            if (!enabled) return;
            Intent launch = new Intent(context, MainActivity.class);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(launch);
            Log.i(TAG, "Vision launch requested after " + action);
        } catch (Exception error) {
            Log.w(TAG, "Android blocked Vision auto-launch after " + action, error);
        }
    }
}
