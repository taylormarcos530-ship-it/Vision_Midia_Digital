package com.visionmidia.player;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.InputFilter;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.Toast;
import android.util.Base64;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import java.util.Locale;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final String PREFS = "vision_player_prefs";
    private static final String KEY_SETUP_CODE = "company_setup_code";
    public static final String KEY_AUTOSTART = "autostart_enabled";
    private static final String KEY_WATCHDOG_RECOVERY_AT = "watchdog_recovery_at";
    private static final String KEY_REMOTE_COMPAT = "remote_network_compat";
    private static final String LOCAL_PLAYER = "https://appassets.androidplatform.net/assets/player.html";
    private static final String REMOTE_PLAYER_FALLBACK = "https://vision-midia-digital-rkoqfnct1-vision-5529.vercel.app/player.html";

    private WebView webView;
    private SharedPreferences prefs;
    private WebViewAssetLoader assetLoader;
    private final Handler watchdogHandler = new Handler(Looper.getMainLooper());
    private volatile long lastPlayerPulseAt = 0L;
    private boolean watchdogActive = false;
    private final Runnable playerWatchdog = new Runnable() {
        @Override
        public void run() {
            if (!watchdogActive) return;
            long silentFor = SystemClock.elapsedRealtime() - lastPlayerPulseAt;
            if (lastPlayerPulseAt > 0L && silentFor > 120_000L && webView != null) {
                lastPlayerPulseAt = SystemClock.elapsedRealtime();
                if (prefs != null) prefs.edit().putLong(KEY_WATCHDOG_RECOVERY_AT, System.currentTimeMillis()).apply();
                String setupCode = prefs == null ? "" : prefs.getString(KEY_SETUP_CODE, "");
                if (isValidSetupCode(setupCode)) loadPlayer(setupCode);
            }
            watchdogHandler.postDelayed(this, 30_000L);
        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();

        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        setContentView(webView);
        configureWebView();

        applySetupFromIntent(getIntent());
        String setupCode = prefs.getString(KEY_SETUP_CODE, "");
        if (isValidSetupCode(setupCode)) {
            loadPlayer(setupCode);
        } else {
            showSetupDialog(false);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (applySetupFromIntent(intent)) {
            loadPlayer(prefs.getString(KEY_SETUP_CODE, ""));
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);

        webView.addJavascriptInterface(new PlayerBridge(), "VisionAndroid");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClientCompat() {
            @Nullable
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });
    }

    private void loadPlayer(String setupCode) {
        if (!isValidSetupCode(setupCode)) {
            showSetupDialog(false);
            return;
        }
        String base = prefs.getBoolean(KEY_REMOTE_COMPAT, false) ? REMOTE_PLAYER_FALLBACK : LOCAL_PLAYER;
        String url = base + "?setup=" + Uri.encode(setupCode.toUpperCase(Locale.ROOT));
        webView.loadUrl(url);
    }

    private void loadRemoteCompatibilityPlayer() {
        String setupCode = prefs.getString(KEY_SETUP_CODE, "");
        if (!isValidSetupCode(setupCode)) {
            showSetupDialog(false);
            return;
        }
        prefs.edit().putBoolean(KEY_REMOTE_COMPAT, true).apply();
        final String url = REMOTE_PLAYER_FALLBACK + "?setup=" + Uri.encode(setupCode.toUpperCase(Locale.ROOT));
        runOnUiThread(() -> webView.loadUrl(url));
    }

    private boolean applySetupFromIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return false;
        Uri uri = intent.getData();
        if (!"visionmidia".equalsIgnoreCase(uri.getScheme()) || !"setup".equalsIgnoreCase(uri.getHost())) return false;
        String code = uri.getLastPathSegment();
        if (!isValidSetupCode(code)) return false;
        code = code.toUpperCase(Locale.ROOT);
        prefs.edit().putString(KEY_SETUP_CODE, code).apply();
        return true;
    }

    private boolean isValidSetupCode(String value) {
        return value != null && value.trim().toUpperCase(Locale.ROOT).matches("[A-F0-9]{8}");
    }

    private void showSetupDialog(boolean allowCancel) {
        final EditText input = new EditText(this);
        input.setHint("Ex.: A1B2C3D4");
        input.setSingleLine(true);
        input.setText(prefs.getString(KEY_SETUP_CODE, ""));
        input.setSelectAllOnFocus(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(8)});
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        input.setPadding(pad, pad / 2, pad, pad / 2);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Configurar Vision Player")
                .setMessage("Digite o código de instalação de 8 caracteres mostrado no painel da empresa. Depois o Player exibirá a imagem personalizada e o código de 6 dígitos para vincular esta TV.")
                .setView(input)
                .setPositiveButton("Continuar", null)
                .setNegativeButton(allowCancel ? "Cancelar" : "Fechar", (d, which) -> {
                    if (!allowCancel) finish();
                })
                .create();
        dialog.setCanceledOnTouchOutside(false);
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String code = input.getText().toString().trim().toUpperCase(Locale.ROOT);
            if (!isValidSetupCode(code)) {
                input.setError("Use exatamente 8 caracteres: A-F e 0-9.");
                return;
            }
            prefs.edit().putString(KEY_SETUP_CODE, code).apply();
            dialog.dismiss();
            loadPlayer(code);
        }));
        dialog.show();
    }

    private void showPlayerMenu() {
        new AlertDialog.Builder(this)
                .setTitle("Vision Player")
                .setMessage("Código da empresa: " + prefs.getString(KEY_SETUP_CODE, "—"))
                .setPositiveButton("Alterar código", (d, which) -> showSetupDialog(true))
                .setNeutralButton("Recarregar", (d, which) -> loadPlayer(prefs.getString(KEY_SETUP_CODE, "")))
                .setNegativeButton("Voltar ao Player", null)
                .show();
    }


    private class PlayerBridge {
        @JavascriptInterface
        public void setAutostart(boolean enabled) {
            prefs.edit().putBoolean(KEY_AUTOSTART, enabled).apply();
        }

        @JavascriptInterface
        public void setOrientation(String mode) {
            final String requested = mode == null ? "auto" : mode.toLowerCase(Locale.ROOT);
            runOnUiThread(() -> {
                if ("portrait".equals(requested)) {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                } else if ("landscape".equals(requested)) {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                } else {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                }
                enterImmersiveMode();
            });
        }

        @JavascriptInterface
        public String postJson(String url, String jsonBody, String apiKey, String deviceToken) {
            HttpURLConnection connection = null;
            try {
                URL target = new URL(url);
                if (!"https".equalsIgnoreCase(target.getProtocol())) {
                    throw new IllegalArgumentException("Apenas HTTPS é permitido.");
                }

                connection = (HttpURLConnection) target.openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(20000);
                connection.setDoOutput(true);
                connection.setUseCaches(false);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Accept", "application/json");
                if (apiKey != null && !apiKey.isEmpty()) connection.setRequestProperty("apikey", apiKey);
                if (deviceToken != null && !deviceToken.isEmpty()) connection.setRequestProperty("x-device-token", deviceToken);

                byte[] payload = (jsonBody == null ? "{}" : jsonBody).getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(payload.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload);
                    output.flush();
                }

                int status = connection.getResponseCode();
                InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                byte[] body = new byte[0];
                if (input != null) {
                    try (InputStream stream = input; ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
                        byte[] chunk = new byte[4096];
                        int read;
                        while ((read = stream.read(chunk)) != -1) buffer.write(chunk, 0, read);
                        body = buffer.toByteArray();
                    }
                }
                return status + "\n" + Base64.encodeToString(body, Base64.NO_WRAP);
            } catch (Exception error) {
                String message = "Falha de rede no TV Box: " + error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
                return "0\n" + Base64.encodeToString(message.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }

        @JavascriptInterface
        public void useRemotePlayer() {
            loadRemoteCompatibilityPlayer();
        }

        @JavascriptInterface
        public void playerAlive() {
            lastPlayerPulseAt = SystemClock.elapsedRealtime();
        }

        @JavascriptInterface
        public String getAppVersion() {
            try {
                String versionName = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
                return versionName == null ? "" : versionName;
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public String consumeWatchdogRecovery() {
            long recoveredAt = prefs.getLong(KEY_WATCHDOG_RECOVERY_AT, 0L);
            if (recoveredAt <= 0L) return "";
            prefs.edit().remove(KEY_WATCHDOG_RECOVERY_AT).apply();
            return String.valueOf(recoveredAt);
        }

        @JavascriptInterface
        public void restartApp() {
            lastPlayerPulseAt = SystemClock.elapsedRealtime();
            runOnUiThread(() -> {
                Intent restart = getPackageManager().getLaunchIntentForPackage(getPackageName());
                if (restart == null) {
                    loadPlayer(prefs.getString(KEY_SETUP_CODE, ""));
                    return;
                }
                restart.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(restart);
                finish();
            });
        }
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_MENU) {
            showPlayerMenu();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
        lastPlayerPulseAt = SystemClock.elapsedRealtime();
        watchdogActive = true;
        watchdogHandler.removeCallbacks(playerWatchdog);
        watchdogHandler.postDelayed(playerWatchdog, 30_000L);
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        watchdogActive = false;
        watchdogHandler.removeCallbacks(playerWatchdog);
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        watchdogActive = false;
        watchdogHandler.removeCallbacks(playerWatchdog);
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
