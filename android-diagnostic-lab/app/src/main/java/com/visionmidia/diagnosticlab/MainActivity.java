package com.visionmidia.diagnosticlab;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.VideoView;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

public final class MainActivity extends Activity {
    private static final String[] PROGRAM = {
        "AUTO CENTER · Troca de óleo", "AUTO CENTER · Suspensão",
        "AUTO CENTER · Freios", "ANÚNCIO FICTÍCIO · Empresa A",
        "AUTO CENTER · Escapamento", "AUTO CENTER · Motor",
        "AUTO CENTER · Revisão", "ANÚNCIO FICTÍCIO · Empresa B"
    };
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final int navy = Color.rgb(11, 23, 40);
    private final int amber = Color.rgb(255, 202, 83);
    private TextView status, position, info, displayText, mediaReport, screenStatus;
    private FrameLayout frame;
    private VideoView video;
    private Runnable activeTask;
    private int generation = 0, current = 0, completed = 0, round = 1;
    private int decoded = 0, decodeErrors = 0;
    private boolean running = false, disconnected = false, rebooting = false;
    private boolean resumeOnConnection = false, portrait = false, videoMode = false;
    private File sampleFile;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        makeInterface();
        showProgram("Pronto. Este APK é apenas diagnóstico, sem cliente conectado.");
    }

    private int dp(int amount) {
        return Math.round(getResources().getDisplayMetrics().density * amount);
    }

    private GradientDrawable background(int fill, int stroke) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(10));
        d.setStroke(dp(2), stroke);
        return d;
    }

    private TextView text(String value, int size, int color) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(size);
        t.setTextColor(color);
        t.setPadding(dp(10), dp(7), dp(10), dp(7));
        return t;
    }

    private LinearLayout vertical() {
        LinearLayout result = new LinearLayout(this);
        result.setOrientation(LinearLayout.VERTICAL);
        return result;
    }

    private Button button(String label, Runnable action) {
        Button b = new Button(this);
        b.setAllCaps(false);
        b.setText(label);
        b.setTextColor(Color.WHITE);
        b.setTextSize(16);
        b.setMinHeight(dp(52));
        b.setBackground(background(Color.rgb(29, 58, 88), amber));
        b.setFocusable(true);
        b.setOnClickListener(v -> action.run());
        b.setOnFocusChangeListener((v, hasFocus) ->
            b.setBackground(background(hasFocus?Color.rgb(91, 68, 24):Color.rgb(29, 58, 88),
                                       hasFocus?Color.WHITE:amber)));
        return b;
    }

    private void pair(LinearLayout root, Button a, Button b) {
        LinearLayout line = new LinearLayout(this);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(65), 1f);
        p.setMargins(dp(3), dp(2), dp(3), dp(3));
        line.addView(a, p);
        line.addView(b, new LinearLayout.LayoutParams(p));
        root.addView(line);
    }

    private void corner(String label, int gravity) {
        TextView t = text(label, 12, amber);
        t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        t.setBackgroundColor(Color.rgb(24, 51, 75));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, gravity);
        frame.addView(t, lp);
    }

    private void makeInterface() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(navy);
        LinearLayout root = vertical();
        root.setPadding(dp(9), dp(7), dp(9), dp(22));
        scroll.addView(root);
        setContentView(scroll);

        TextView title = text("VISION · DIAGNÓSTICO TESTE", 23, amber);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(title);
        TextView warning = text(
           "APK SEPARADO · SEM LOGIN · SEM INTERNET · NÃO ALTERA O PLAYER DO CLIENTE", 13, Color.WHITE);
        warning.setBackground(background(Color.rgb(74, 47, 16), amber));
        root.addView(warning);

        frame = new FrameLayout(this);
        frame.setBackground(background(Color.rgb(18, 34, 52), amber));
        LinearLayout.LayoutParams area = new LinearLayout.LayoutParams(
           LinearLayout.LayoutParams.MATCH_PARENT, dp(235));
        area.setMargins(dp(3), dp(14), dp(3), dp(9));
        root.addView(frame, area);

        displayText = text("", 22, Color.WHITE);
        displayText.setGravity(Gravity.CENTER);
        displayText.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        frame.addView(displayText, new FrameLayout.LayoutParams(-1,-1));
        corner("↖ CANTO 1", Gravity.TOP|Gravity.LEFT);
        corner("CANTO 2 ↗", Gravity.TOP|Gravity.RIGHT);
        corner("↙ CANTO 3", Gravity.BOTTOM|Gravity.LEFT);
        corner("CANTO 4 ↘", Gravity.BOTTOM|Gravity.RIGHT);
        video = new VideoView(this);
        video.setVisibility(View.GONE);
        frame.addView(video, new FrameLayout.LayoutParams(-1, -1));
        video.setOnPreparedListener(mp -> {
            mp.setVolume(0f,0f);
            video.start();
            mediaReport.setText("MP4 H.264 incorporado: reproduzindo, áudio desligado.");
        });
        video.setOnCompletionListener(mp -> {
            if (!videoMode) return;
            decoded++;
            videoMode = false;
            video.setVisibility(View.GONE);
            mediaReport.setText("MP4 H.264 concluído pelo decodificador. Testes concluídos: "+decoded);
            showProgram("Vídeo encerrado normalmente. Nenhuma impressão registrada.");
        });
        video.setOnErrorListener((mp,what,extra) -> {
            decodeErrors++;
            videoMode = false;
            video.setVisibility(View.GONE);
            mediaReport.setText("Falha do decodificador neste aparelho. Código: "+what+
                                " / "+extra+". Falhas: "+decodeErrors);
            showProgram("Vídeo não reproduzido. Nenhuma conclusão contabilizada.");
            return true;
        });

        position = text("", 19, amber);
        root.addView(position);
        status = text("", 17, Color.WHITE);
        root.addView(status);
        mediaReport = text("Vídeo MP4 de teste: ainda não executado.", 15, Color.LTGRAY);
        root.addView(mediaReport);
        screenStatus = text("", 14, Color.LTGRAY);
        root.addView(screenStatus);

        LinearLayout controls = vertical();
        root.addView(controls);
        pair(controls,button("▶ Rodar sequência",this::startSequence),
                      button("⏸ Pausar",this::pauseSequence));
        pair(controls,button("Simular queda (3 s)",this::dropConnection),
                      button("Reconectar agora",this::reconnect));
        pair(controls,button("Simular reinício (2 s)",this::fakeRestart),
                      button("▶ Testar MP4 embutido",this::testEmbeddedVideo));
        pair(controls,button("Simular HORIZONTAL",() -> setPortrait(false)),
                      button("Simular VERTICAL",() -> setPortrait(true)));
        pair(controls,button("Tela cheia",this::fullscreen),
                      button("Escolher MP4 (opcional)",this::pickVideo));

        info = text("", 13, Color.LTGRAY);
        root.addView(info);
        refreshDeviceInfo();
        // D-pad/remote navigation: first button receives focus without requiring a mouse.
        controls.getChildAt(0).requestFocus();
    }

    private void refreshDeviceInfo() {
        DisplayMetrics metrics = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getMetrics(metrics);
        info.setText("Modelo declarado: "+Build.MODEL+
            " · Android "+Build.VERSION.RELEASE+
            "\nJanela: "+metrics.widthPixels+" × "+metrics.heightPixels+
            " px · teste visual "+(portrait?"VERTICAL":"HORIZONTAL")+
            "\nRodadas e reconexão são fictícias. Não há conexão de rede, cache real ou pareamento.");
        screenStatus.setText("Área de teste: "+(portrait?"9:16 vertical":"16:9 horizontal")+
            " (simulação, não gira a TV). Os quatro cantos devem ficar visíveis.");
    }

    private void showProgram(String message) {
        displayText.setText(videoMode?"VÍDEO LOCAL DE TESTE":PROGRAM[current]);
        position.setText("Rodada "+round+" · item "+(current+1)+" de 8"+
                         " · fins simulados: "+completed);
        status.setText(message);
    }

    private void cancelTimer() {
        generation++;
        if(activeTask!=null){handler.removeCallbacks(activeTask);activeTask=null;}
    }

    private void advanceLater() {
        cancelTimer();
        if(!running||disconnected||rebooting||videoMode)return;
        final int expected = generation;
        activeTask=() -> {
            activeTask=null;
            if(expected!=generation||!running||disconnected||rebooting||videoMode)return;
            completed++;
            current++;
            if(current==PROGRAM.length){current=0;round++;}
            showProgram("Próxima mídia fictícia. Sem publicação e sem contagem real.");
            advanceLater();
        };
        handler.postDelayed(activeTask,2000);
    }

    private void stopVideo() {
        videoMode=false;
        video.stopPlayback();
        video.setVisibility(View.GONE);
    }

    private void startSequence() {
        if(rebooting){showProgram("Aguarde concluir o reinício fictício.");return;}
        if(disconnected){showProgram("Sem conexão fictícia; aguarde reconexão.");return;}
        stopVideo();running=true;
        showProgram("Sequência fictícia em andamento.");
        advanceLater();
    }

    private void pauseSequence() {
        cancelTimer();
        running=false;resumeOnConnection=false;
        if(videoMode){video.pause();stopVideo();}
        showProgram("Pausado no mesmo item. Use Rodar sequência para continuar.");
    }

    private void dropConnection() {
        if(disconnected||rebooting){showProgram("Interrupção já em andamento.");return;}
        resumeOnConnection=running;
        cancelTimer();running=false;disconnected=true;
        if(videoMode)stopVideo();
        showProgram("SEM CONEXÃO fictícia · reconectará em ~3 segundos.");
        final int expected=generation;
        activeTask=() -> {
            activeTask=null;
            if(expected!=generation||!disconnected||rebooting)return;
            reconnect();
        };
        handler.postDelayed(activeTask,3000);
    }

    private void reconnect() {
        if(rebooting){showProgram("Aguarde o reinício.");return;}
        if(!disconnected){showProgram("Conexão fictícia já ativa.");return;}
        cancelTimer();disconnected=false;
        running=resumeOnConnection;resumeOnConnection=false;
        showProgram(running?"Reconectado: mesma rodada e mídia, avanço retomado.":
                            "Reconectado: posição preservada, reprodução pausada.");
        if(running)advanceLater();
    }

    private void fakeRestart() {
        if(rebooting)return;
        boolean resume=running||resumeOnConnection;
        cancelTimer();running=false;disconnected=false;resumeOnConnection=false;
        if(videoMode)stopVideo();
        rebooting=true;
        showProgram("REINICIANDO ficticiamente por 2 segundos…");
        final int expected=generation;
        activeTask=() -> {
            activeTask=null;
            if(expected!=generation||!rebooting)return;
            rebooting=false;running=resume;
            showProgram(running?"Reinício fictício concluído. Mesma mídia e rodada; avanço retomado.":
                                "Reinício fictício concluído; pronto para iniciar.");
            if(running)advanceLater();
        };
        handler.postDelayed(activeTask,2000);
    }

    private void setPortrait(boolean portraitMode) {
        portrait=portraitMode;
        LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(
            portrait?dp(230):LinearLayout.LayoutParams.MATCH_PARENT,
            portrait?dp(350):dp(235));
        params.setMargins(dp(3),dp(14),dp(3),dp(9));
        params.gravity=Gravity.CENTER_HORIZONTAL;
        frame.setLayoutParams(params);
        refreshDeviceInfo();
        showProgram("Formato do quadro simulado. A orientação física da TV não muda.");
    }

    @SuppressWarnings("deprecation")
    private void fullscreen() {
        View root=getWindow().getDecorView();
        int flags=View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|
                  View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        root.setSystemUiVisibility(root.getSystemUiVisibility()==flags?0:flags);
        showProgram("Tela cheia do aplicativo solicitada. Navegação do Android pode variar.");
    }

    private File bundledFile() throws IOException {
        if(sampleFile!=null&&sampleFile.exists())return sampleFile;
        File dest=new File(getCacheDir(),"vision-diagnostico-teste.mp4");
        try(InputStream in=getAssets().open("sample_h264_baseline.b64");
            FileOutputStream out=new FileOutputStream(dest)) {
            byte[] buf=new byte[4096];
            java.io.ByteArrayOutputStream data=new java.io.ByteArrayOutputStream();
            int size;
            while((size=in.read(buf))!=-1)data.write(buf,0,size);
            byte[] bytes=Base64.decode(data.toByteArray(),Base64.DEFAULT);
            out.write(bytes);
        }
        sampleFile=dest;
        return dest;
    }

    private void testEmbeddedVideo() {
        try {
            File f=bundledFile();
            startVideo(Uri.fromFile(f),"MP4 H.264 BASELINE embutido");
        }catch(Exception e){
            decodeErrors++;
            mediaReport.setText("Não foi possível preparar o MP4 local: "+e.getClass().getSimpleName());
        }
    }

    private void startVideo(Uri uri,String label) {
        cancelTimer();running=false;resumeOnConnection=false;disconnected=false;rebooting=false;
        stopVideo();
        videoMode=true;
        video.setVisibility(View.VISIBLE);
        mediaReport.setText(label+": iniciando decoder nativo, sem internet.");
        showProgram("Aguardando reprodução local do vídeo.");
        video.setVideoURI(uri);
        video.requestFocus();
        // Actual video.start() is called only when the media player is prepared.
    }

    private void pickVideo() {
        try {
            Intent intent=new Intent(Intent.ACTION_GET_CONTENT);
            intent.setType("video/*");
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            startActivityForResult(intent,71);
        }catch(ActivityNotFoundException e){
            mediaReport.setText("Este aparelho não possui seletor de arquivos. Use o MP4 embutido.");
        }
    }

    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(request==71&&result==RESULT_OK&&data!=null&&data.getData()!=null)
            startVideo(data.getData(),"MP4 local selecionado");
    }

    @Override protected void onPause() {
        super.onPause();
        cancelTimer();running=false;resumeOnConnection=false;
        if(videoMode){video.pause();stopVideo();}
        if(status!=null)showProgram("Aplicativo em segundo plano: testes pausados.");
    }

    @Override protected void onDestroy() {
        cancelTimer();stopVideo();handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
