package com.visionmidia.player;

import android.app.Application;
import android.util.Log;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;

public final class VisionFcmApplication extends Application {
    static final String PREFS = "vision_player_prefs";
    static final String FCM_TOKEN_KEY = "vision_fcm_token";
    static final String PUSH_SIGNAL_KEY = "vision_fcm_command_signal";

    public static boolean isConfigured() {
        return !BuildConfig.VISION_FCM_APP_ID.isEmpty()
                && !BuildConfig.VISION_FCM_API_KEY.isEmpty()
                && !BuildConfig.VISION_FCM_PROJECT_ID.isEmpty()
                && !BuildConfig.VISION_FCM_SENDER_ID.isEmpty();
    }

    @Override public void onCreate() {
        super.onCreate();
        if (!isConfigured()) return;
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this) != ConnectionResult.SUCCESS) {
            Log.w("VisionFCM", "Google Play Services unavailable; polling fallback remains");
            return;
        }
        try {
            if (FirebaseApp.getApps(this).isEmpty()) {
                FirebaseOptions options = new FirebaseOptions.Builder()
                        .setApplicationId(BuildConfig.VISION_FCM_APP_ID)
                        .setApiKey(BuildConfig.VISION_FCM_API_KEY)
                        .setProjectId(BuildConfig.VISION_FCM_PROJECT_ID)
                        .setGcmSenderId(BuildConfig.VISION_FCM_SENDER_ID).build();
                FirebaseApp.initializeApp(this, options);
            }
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> {
                if (token == null || token.isEmpty()) return;
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(FCM_TOKEN_KEY, token).apply();
            }).addOnFailureListener(error -> Log.w("VisionFCM", "Token unavailable; polling fallback", error));
        } catch (RuntimeException error) {
            Log.w("VisionFCM", "FCM unavailable; existing player unaffected", error);
        }
    }
}
