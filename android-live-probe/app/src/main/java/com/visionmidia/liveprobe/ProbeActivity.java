package com.visionmidia.liveprobe;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public final class ProbeActivity extends Activity {
 private static final int CAPTURE=41,NOTIFICATIONS=42;
 private final Handler handler=new Handler(Looper.getMainLooper());
 private long pending=-1;
 private TextView status;
 private Button start,stop;
 @Override public void onCreate(Bundle saved){
  super.onCreate(saved);if(saved!=null)pending=saved.getLong("pending",-1);
  ScrollView scroll=new ScrollView(this);LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(28,40,28,28);scroll.addView(layout);setContentView(scroll);
  TextView title=new TextView(this);title.setText("Vision Live — Ensaio");title.setTextSize(26);layout.addView(title);
  TextView instructions=new TextView(this);instructions.setText("Teste local de captura e encoder, até 3 minutos. Android 10 ou superior.\n\nPermita notificações e selecione a tela inteira na confirmação do Android. Depois abra o Vision Player manualmente.\n\nNão transmite, não grava e não altera o Player. Use um aparelho de ensaio.");instructions.setTextSize(18);layout.addView(instructions);
  start=new Button(this);start.setText("Iniciar ensaio");start.setOnClickListener(v->begin());layout.addView(start);
  stop=new Button(this);stop.setText("Parar ensaio");stop.setOnClickListener(v->{
   long id=ProbeService.POLICY.generation();
   if(ProbeService.busy)startService(new Intent(this,ProbeService.class).setAction(ProbeService.STOP).putExtra("generation",id));
   else{ProbeService.POLICY.stop(id);ProbeService.status="Solicitação cancelada.";}
  });layout.addView(stop);
  status=new TextView(this);status.setTextSize(18);layout.addView(status);
 }
 private void begin(){
  if(pending!=-1||ProbeService.busy)return;
  String reason=CaptureSupport.reason(Build.VERSION.SDK_INT,true);
  if(reason!=null){ProbeService.status=reason;return;}
  if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},NOTIFICATIONS);return;}
  ProbeService.ensureNotificationChannel(this);
  reason=CaptureSupport.reason(Build.VERSION.SDK_INT,ProbeService.notificationsAvailable(this));
  if(reason!=null){ProbeService.status=reason;return;}
  long id=ProbeService.POLICY.startRequest(SystemClock.elapsedRealtime());if(id<0)return;
  pending=id;ProbeService.status="Aguardando consentimento do Android (até 30 segundos)…";
  try{startActivityForResult(getSystemService(MediaProjectionManager.class).createScreenCaptureIntent(),CAPTURE);handler.postDelayed(consentDeadline,SessionPolicy.CONSENT_TIMEOUT_MS);}
  catch(RuntimeException error){ProbeService.POLICY.stop(id);pending=-1;ProbeService.status="Captura não disponível neste aparelho.";}
 }
 @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){
  super.onRequestPermissionsResult(request,permissions,results);
  if(request==NOTIFICATIONS){if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)begin();else ProbeService.status=CaptureSupport.reason(Build.VERSION.SDK_INT,false);}
 }
 private final Runnable consentDeadline=()->{
  if(ProbeService.POLICY.state()==SessionPolicy.State.WAITING_CONSENT&&ProbeService.POLICY.isExpired(SystemClock.elapsedRealtime())){
   ProbeService.POLICY.stop(pending);ProbeService.status="Consentimento expirado. Feche a confirmação e inicie novamente.";
  }
 };
 @Override public void onActivityResult(int request,int result,Intent data){
  super.onActivityResult(request,result,data);if(request!=CAPTURE)return;
  long id=pending;pending=-1;handler.removeCallbacks(consentDeadline);
  if(!ProbeService.POLICY.consentResult(id,result==RESULT_OK&&data!=null,SystemClock.elapsedRealtime())){ProbeService.status="Consentimento negado, cancelado ou expirado.";return;}
  Intent service=new Intent(this,ProbeService.class).putExtra("generation",id).putExtra("result",result).putExtra("consent",data);
  try{if(Build.VERSION.SDK_INT>=26)startForegroundService(service);else startService(service);}
  catch(RuntimeException error){ProbeService.POLICY.stop(id);ProbeService.status="O Android não permitiu iniciar o serviço.";}
 }
 private final Runnable refresh=new Runnable(){public void run(){
  consentDeadline.run();status.setText(ProbeService.status);
  SessionPolicy.State state=ProbeService.POLICY.state();
  start.setEnabled(pending==-1&&!ProbeService.busy&&(state==SessionPolicy.State.IDLE||state==SessionPolicy.State.STOPPED));
  stop.setEnabled(state==SessionPolicy.State.WAITING_CONSENT||state==SessionPolicy.State.CAPTURING);
  handler.postDelayed(this,500);
 }};
 @Override public void onResume(){super.onResume();handler.post(refresh);}
 @Override public void onPause(){handler.removeCallbacks(refresh);super.onPause();}
 @Override public void onSaveInstanceState(Bundle out){out.putLong("pending",pending);super.onSaveInstanceState(out);}
 @Override public void onDestroy(){handler.removeCallbacksAndMessages(null);if(isFinishing()&&ProbeService.POLICY.state()==SessionPolicy.State.WAITING_CONSENT)ProbeService.POLICY.stop(pending);super.onDestroy();}
}
