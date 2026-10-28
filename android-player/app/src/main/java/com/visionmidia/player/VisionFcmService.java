package com.visionmidia.player;

import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class VisionFcmService extends FirebaseMessagingService {
    @Override public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        if (!token.isEmpty()) getSharedPreferences(VisionFcmApplication.PREFS, MODE_PRIVATE)
                .edit().putString(VisionFcmApplication.FCM_TOKEN_KEY, token).apply();
    }

    @Override public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);
        // A push only prompts an authenticated lookup. It NEVER executes a raw command.
        if (!"vision_command".equals(message.getData().get("kind"))) return;
        String commandId = message.getData().get("command_id");
        if (commandId == null || !commandId.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) return;
        SharedPreferences prefs = getSharedPreferences(VisionFcmApplication.PREFS, MODE_PRIVATE);
        if (prefs.getString("device_token", "").isEmpty()) return;
        prefs.edit().putBoolean(VisionFcmApplication.PUSH_SIGNAL_KEY, true).apply();
    }
}
