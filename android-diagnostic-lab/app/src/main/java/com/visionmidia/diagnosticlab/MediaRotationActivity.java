package com.visionmidia.diagnosticlab;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.VideoView;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Purely local TV Box experiment: 6 real decoder completions and 2 fictional ad images per cycle.
 * This activity neither imports nor controls the operational Vision player.
 */
public final class MediaRotationActivity extends Activity {
    private static final String[] BASE = {
        "Troca de óleo", "Suspensão", "Freios", "Escapamento", "Motor", "Revisão"
    };
    // Three point videos, one commercial image, three point videos, one commercial image.
    private static final int[] SEQUENCE = {0,1,2,-1,3,4,5,-2};
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final int navy = Color.rgb(10,23,39), amber=Color.rgb(251,195,74);
    private LinearLayout root;
    private FrameLayout stage;
    private VideoView video;
    private ImageView adImage;
    private TextView stageLabel,heading,notice,progress;
    private Runnable timer;
    private int generation=0, itemIndex=0, round=1, concluded=0, commercialsShown=0;
    private int clipPosition=0;
    private boolean running=false,prepared=false,disconnected=false,rebooting=false;
    private boolean adVisitCounted=false;
    private boolean resumeAfterDrop=false,failed=false,videoReady=false;
    private File clip;
    private Bitmap adA,adB;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        makeUI();
        drawCurrent();
        writeStatus("Modo experimental pronto. Arquivos locais; zero conexão com clientes.");
    }
    private int dp(int n){return Math.round(getResources().getDisplayMetrics().density*n);}
    private TextView label(String content,int size,int color){
        TextView t=new TextView(this);
        t.setText(content);t.setTextSize(size);t.setTextColor(color);
        t.setGravity(Gravity.CENTER);t.setPadding(dp(7),dp(7),dp(7),dp(7));
        return t;
    }
    private GradientDrawable bg(int color,int border){
        GradientDrawable d=new GradientDrawable();d.setColor(color);
        d.setStroke(dp(2),border);d.setCornerRadius(dp(10));return d;
    }
    private Button button(String name,Runnable click){
        Button b=new Button(this);b.setAllCaps(false);b.setText(name);
        b.setTextColor(Color.WHITE);b.setTextSize(15);b.setMinHeight(dp(52));
        b.setBackground(bg(Color.rgb(27,60,92),amber));
        b.setFocusable(true);b.setOnClickListener(v->click.run());
        b.setOnFocusChangeListener((v,focus)->b.setBackground(bg(
            focus?Color.rgb(110,72,14):Color.rgb(27,60,92),focus?Color.WHITE:amber)));
        return b;
    }
    private void buttons(LinearLayout parent,Button a,Button b){
        LinearLayout pair=new LinearLayout(this);
        for(Button item:new Button[]{a,b}){
            LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(62),1);
            p.setMargins(dp(4),dp(3),dp(4),dp(3));pair.addView(item,p);
        }
        parent.addView(pair);
    }
    private void makeUI(){
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(navy);root.setPadding(dp(8),dp(6),dp(8),dp(7));
        setContentView(root);
        heading=label("VISION · MÍDIA REAL + ANÚNCIO FICTÍCIO",19,amber);
        heading.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        root.addView(heading);
        progress=label("",14,Color.WHITE);root.addView(progress);
        stage=new FrameLayout(this);
        stage.setBackground(bg(Color.rgb(7,17,33),amber));
        LinearLayout.LayoutParams space=new LinearLayout.LayoutParams(-1,0,1);
        space.setMargins(dp(5),dp(6),dp(5),dp(6));root.addView(stage,space);
        video=new VideoView(this);
        video.setVisibility(View.GONE);
        stage.addView(video,new FrameLayout.LayoutParams(-1,-1));
        adImage=new ImageView(this);
        adImage.setScaleType(ImageView.ScaleType.FIT_CENTER);
        adImage.setVisibility(View.GONE);
        stage.addView(adImage,new FrameLayout.LayoutParams(-1,-1));
        stageLabel=label("",23,Color.WHITE);
        stageLabel.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        stageLabel.setBackgroundColor(Color.argb(185,7,17,33));
        FrameLayout.LayoutParams labelLayout=new FrameLayout.LayoutParams(-1,
            FrameLayout.LayoutParams.WRAP_CONTENT,Gravity.TOP);
        stage.addView(stageLabel,labelLayout);
        notice=label("",14,amber);
        notice.setBackground(bg(Color.rgb(18,44,63),amber));
        root.addView(notice);
        buttons(root,button("▶ Iniciar rodízio real",this::begin),
                     button("⏸ Pausar",this::pausePlayback));
        buttons(root,button("Simular queda 3 s",this::drop),
                     button("Simular reinício 2 s",this::restart));
        buttons(root,button("Voltar ao diagnóstico",this::finish),
                     button("Recomeçar do item 1",this::reset));
        adA=makeImage("PUBLICIDADE FICTÍCIA","EMPRESA A",
                      Color.rgb(44,83,128),Color.rgb(245,191,78));
        adB=makeImage("PUBLICIDADE FICTÍCIA","EMPRESA B",
                      Color.rgb(23,107,95),Color.rgb(241,208,89));
    }
    private Bitmap makeImage(String top,String bottom,int color,int foreground){
        Bitmap image=Bitmap.createBitmap(960,540,Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(image);
        canvas.drawColor(color);
        Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(foreground);paint.setStrokeWidth(10);
        canvas.drawRect(22,22,938,518,paint);
        paint.setColor(color);canvas.drawRect(35,35,925,505,paint);
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setColor(Color.WHITE);paint.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));
        paint.setTextSize(53);canvas.drawText(top,480,195,paint);
        paint.setColor(foreground);paint.setTextSize(87);
        canvas.drawText(bottom,480,320,paint);
        paint.setColor(Color.WHITE);paint.setTextSize(25);
        canvas.drawText("SEM ANUNCIANTE REAL · LABORATÓRIO OFFLINE",480,444,paint);
        return image;
    }
    private void invalidateCallbacks(){
        generation++;
        if(timer!=null){handler.removeCallbacks(timer);timer=null;}
    }
    private boolean isAd(){return SEQUENCE[itemIndex]<0;}
    private void writeStatus(String message){
        notice.setText(message);
        progress.setText("Rodada "+round+" · item "+(itemIndex+1)+"/8 · concluídos "+concluded+
            " · comerciais fictícios exibidos "+commercialsShown);
    }
    private void drawCurrent(){
        int source=SEQUENCE[itemIndex];
        stageLabel.setText(source<0?"ANÚNCIO FICTÍCIO · EMPRESA "+(source==-1?"A":"B"):
            "AUTO CENTER · "+BASE[source]+" (mesmo MP4 H.264 azul)");
        if(source<0){
            video.setVisibility(View.GONE);
            adImage.setImageBitmap(source==-1?adA:adB);
            adImage.setVisibility(View.VISIBLE);
        } else {
            adImage.setVisibility(View.GONE);
            video.setVisibility(View.VISIBLE);
        }
        writeStatus(running?"Reprodução em andamento.":"Posição preservada; toque em Iniciar.");
    }
    private File localVideo() throws IOException{
        if(clip!=null&&clip.exists())return clip;
        File result=new File(getCacheDir(),"vision-lab-intercalacao.mp4");
        try(InputStream in=getAssets().open("sample_h264_baseline.b64");
            ByteArrayOutputStream buffer=new ByteArrayOutputStream();
            FileOutputStream out=new FileOutputStream(result)){
            byte[] bytes=new byte[4096];int count;
            while((count=in.read(bytes))!=-1)buffer.write(bytes,0,count);
            out.write(Base64.decode(buffer.toByteArray(),Base64.DEFAULT));
        }
        clip=result;return clip;
    }
    private void startCurrent(){
        invalidateCallbacks();
        if(!running||failed||disconnected||rebooting)return;
        drawCurrent();
        final int token=generation;
        if(isAd()){
            // Bitmap display is a real image; the 2 s expiration is simulated.
            if(!adVisitCounted){commercialsShown++;adVisitCounted=true;}
            writeStatus("Imagem comercial local fictícia visível por 2 segundos.");
            timer=()->{
                timer=null;
                if(token!=generation||!running||disconnected||rebooting||failed)return;
                completeCurrent();
            };
            handler.postDelayed(timer,2000);
            return;
        }
        try{
            File asset=localVideo();
            prepared=false;
            video.setOnPreparedListener(mp->{
                if(token!=generation||failed)return;
                mp.setVolume(0f,0f);
                prepared=true;
                if(running&&!disconnected&&!rebooting)video.start();
            });
            video.setOnCompletionListener(mp->{
                if(token!=generation||!running||!prepared||failed)return;
                prepared=false;
                completeCurrent(); // NEVER a timer for MP4; requires decoder's ended event.
            });
            video.setOnErrorListener((mp,what,extra)->{
                if(token!=generation)return true;
                fail("ERRO MP4 ("+what+"/"+extra+"). Rodízio interrompido, nenhuma conclusão falsa.");
                return true;
            });
            video.setVideoURI(Uri.fromFile(asset));
            writeStatus("Reproduzindo MP4 H.264 local: o próximo item só inicia quando terminar.");
        }catch(Exception ex){fail("MP4 indisponível: "+ex.getClass().getSimpleName());}
    }
    private void completeCurrent(){
        invalidateCallbacks();
        if(!running||failed||disconnected||rebooting)return;
        concluded++;
        adVisitCounted=false;
        itemIndex++;
        if(itemIndex==SEQUENCE.length){itemIndex=0;round++;}
        video.stopPlayback();
        clipPosition=0;
        startCurrent();
    }
    private void fail(String message){
        invalidateCallbacks();
        running=false;failed=true;prepared=false;
        video.stopPlayback();
        writeStatus(message);
    }
    private void begin(){
        if(failed){writeStatus("Erro anterior. Toque em Recomeçar para limpar a falha.");return;}
        if(disconnected||rebooting){writeStatus("Aguarde o retorno da simulação.");return;}
        if(running){writeStatus("Rodízio já em andamento.");return;}
        running=true;
        if(isAd()){
            startCurrent();
        }else if(prepared){
            video.start();
            writeStatus("MP4 retomado da posição pausada.");
        }else{
            startCurrent();
        }
    }
    private void pausePlayback(){
        boolean wasRunning=running;running=false;resumeAfterDrop=false;
        invalidateCallbacks();
        if(!isAd()&&wasRunning&&prepared){
            clipPosition=video.getCurrentPosition();video.pause();
        }
        writeStatus("Pausado, item preservado.");
    }
    private void drop(){
        if(disconnected||rebooting||failed)return;
        boolean previouslyRunning=running;
        pausePlayback();
        resumeAfterDrop=previouslyRunning;disconnected=true;
        writeStatus("SEM CONEXÃO FICTÍCIA · retornará em 3 segundos.");
        final int token=generation;
        timer=()->{
            timer=null;
            if(token!=generation||!disconnected||rebooting)return;
            disconnected=false;boolean resume=resumeAfterDrop;resumeAfterDrop=false;
            if(resume){begin();}
            else writeStatus("Reconectado, permanece pausado.");
        };
        handler.postDelayed(timer,3000);
    }
    private void restart(){
        if(rebooting||failed)return;
        boolean resume=running||resumeAfterDrop;
        pausePlayback();disconnected=false;rebooting=true;
        writeStatus("REINICIANDO FICTICIAMENTE · 2 segundos.");
        final int token=generation;
        timer=()->{
            timer=null;
            if(token!=generation||!rebooting)return;
            rebooting=false;
            if(resume)begin();
            else writeStatus("Reinício concluído, item preservado e pausado.");
        };
        handler.postDelayed(timer,2000);
    }
    private void reset(){
        invalidateCallbacks();running=false;failed=false;disconnected=false;
        rebooting=false;prepared=false;resumeAfterDrop=false;
        video.stopPlayback();
        itemIndex=0;round=1;concluded=0;commercialsShown=0;clipPosition=0;
        adVisitCounted=false;
        drawCurrent();writeStatus("Sequência de laboratório reiniciada no item 1.");
    }
    @Override protected void onPause(){
        super.onPause();
        pausePlayback();invalidateCallbacks();
    }
    @Override protected void onDestroy(){
        invalidateCallbacks();
        video.stopPlayback();
        if(adA!=null)adA.recycle();
        if(adB!=null)adB.recycle();
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
