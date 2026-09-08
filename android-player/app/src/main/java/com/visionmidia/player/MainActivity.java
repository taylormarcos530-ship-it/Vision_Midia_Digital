package com.visionmidia.player;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
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

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import java.util.Locale;

public class MainActivity extends Activity {
    private static final String PREFS = "vision_player_prefs";
    private static final String KEY_SETUP_CODE = "company_setup_code";
    public static final String KEY_AUTOSTART = "autostart_enabled";
    private static final String LOCAL_PLAYER = "https://appassets.androidplatform.net/assets/player.html";

    private WebView webView;
    private SharedPreferences prefs;
    private WebViewAssetLoader assetLoader;

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
        String url = LOCAL_PLAYER + "?setup=" + Uri.encode(setupCode.toUpperCase(Locale.ROOT));
        webView.loadUrl(url);
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
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
