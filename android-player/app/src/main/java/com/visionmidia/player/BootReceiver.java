package com.visionmidia.player;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            boolean enabled = context.getSharedPreferences("vision_player_prefs", Context.MODE_PRIVATE).getBoolean(MainActivity.KEY_AUTOSTART, true);
            if (!enabled) return;
            Intent launch = new Intent(context, MainActivity.class);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            try {
                context.startActivity(launch);
            } catch (Exception ignored) {
                // Alguns Androids/TV Boxes bloqueiam abrir Activity após boot em segundo plano.
            }
        }
    }
}
