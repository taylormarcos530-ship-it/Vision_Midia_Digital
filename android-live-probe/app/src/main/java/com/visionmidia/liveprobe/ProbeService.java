package com.visionmidia.liveprobe;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.display.DisplayManager;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.WindowManager;

public final class ProbeService extends Service {
 static final SessionPolicy POLICY=new SessionPolicy();
 static final String STOP="com.visionmidia.liveprobe.STOP",CHANNEL="capture";
 static volatile String status="Pronto para um ensaio local, sem transmissão.";
 static volatile boolean busy;
 private final Handler main=new Handler(Looper.getMainLooper());
 private HandlerThread thread;
 private Handler worker;
 private CaptureEncoder encoder;
 private long generation;
 private volatile boolean closing;
 private boolean destroyed,released;
 private String configuration="",counters="";
 @Override public IBinder onBind(Intent intent){return null;}
 @Override public int onStartCommand(Intent intent,int flags,int startId){
  if(intent!=null&&STOP.equals(intent.getAction())){
   if(intent.getLongExtra("generation",-1)==generation)finish("Ensaio encerrado pelo usuário.");
   else if(!busy)stopSelf();
   return START_NOT_STICKY;
  }
  if(busy)return START_NOT_STICKY;
  long requested=intent==null?-1:intent.getLongExtra("generation",-1);
  Intent consent=intent==null?null:intent.getParcelableExtra("consent");
  int result=intent==null?0:intent.getIntExtra("result",0);
  if(requested!=POLICY.generation()||POLICY.state()!=SessionPolicy.State.CAPTURING||POLICY.isExpired(SystemClock.elapsedRealtime())||result!=Activity.RESULT_OK||consent==null){
   POLICY.stop(requested);status="Consentimento ausente ou expirado.";stopSelf();return START_NOT_STICKY;
  }
  generation=requested;busy=true;status="Preparando captura local…";
  try{
   String reason=CaptureSupport.reason(Build.VERSION.SDK_INT,notificationsAvailable(this));
   if(reason!=null){finish(reason);return START_NOT_STICKY;}
   showNotification();
   WindowManager windows=getSystemService(WindowManager.class);
   DisplayMetrics metrics=new DisplayMetrics();windows.getDefaultDisplay().getRealMetrics(metrics);
   int width=metrics.widthPixels,height=metrics.heightPixels,density=metrics.densityDpi;
   if(Build.VERSION.SDK_INT>=30){android.graphics.Rect bounds=windows.getMaximumWindowMetrics().getBounds();width=bounds.width();height=bounds.height();}
   final int w=width,h=height;
   thread=new HandlerThread("vision-capture-probe");thread.start();worker=new Handler(thread.getLooper());
   worker.post(()->{
    if(closing)return;
    try{
     MediaProjection projection=getSystemService(MediaProjectionManager.class).getMediaProjection(result,consent);
     if(projection==null)throw new IllegalStateException("Projection unavailable");
     encoder=new CaptureEncoder(worker,getSystemService(DisplayManager.class));
     encoder.start(projection,w,h,density,new CaptureEncoder.Listener(){
      public void onConfigured(String codec,int cw,int ch){main.post(()->{if(!closing){configuration=codec+" • "+cw+"×"+ch;status="Captura local ativa\n"+configuration;}});}
      public void onStats(long frames,long bytes,long elapsed){main.post(()->{if(!closing){counters=frames+" frames • "+bytes+" bytes • "+elapsed/1000+" s";status="Captura local ativa\n"+configuration+"\n"+counters;}});}
      public void onError(String error){main.post(()->finish(error));}
     });
    }catch(Exception error){main.post(()->finish("Não foi possível iniciar: "+error.getClass().getSimpleName()));}
   });
   main.post(expiry);
  }catch(Exception error){finish("Não foi possível iniciar: "+error.getClass().getSimpleName());}
  return START_NOT_STICKY;
 }
 static void ensureNotificationChannel(Context context){
  if(Build.VERSION.SDK_INT>=26)context.getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"Ensaio de captura",NotificationManager.IMPORTANCE_LOW));
 }
 static boolean notificationsAvailable(Context context){
  NotificationManager manager=context.getSystemService(NotificationManager.class);
  if(!manager.areNotificationsEnabled())return false;
  if(Build.VERSION.SDK_INT>=26){NotificationChannel c=manager.getNotificationChannel(CHANNEL);if(c!=null&&c.getImportance()==NotificationManager.IMPORTANCE_NONE)return false;}
  return true;
 }
 private void showNotification(){
  ensureNotificationChannel(this);
  PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,ProbeActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,ProbeService.class).setAction(STOP).putExtra("generation",generation),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
  Notification notification=builder.setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle("Vision Live — ensaio ativo").setContentText("Captura local, sem gravação. Limite: 3 minutos.").setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause,"Parar",stop).build()).build();
  if(Build.VERSION.SDK_INT>=29)startForeground(41,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);else startForeground(41,notification);
 }
 private final Runnable expiry=new Runnable(){public void run(){
  if(closing)return;
  if(!notificationsAvailable(ProbeService.this)){finish("Notificações desativadas. Ensaio encerrado.");return;}
  if(POLICY.isExpired(SystemClock.elapsedRealtime())){finish("Limite de três minutos atingido.");return;}
  main.postDelayed(this,250);
 }};
 private void finish(String reason){
  if(closing)return;closing=true;main.removeCallbacks(expiry);status=reason+"\n"+configuration+"\n"+counters;
  if(worker!=null)worker.post(()->{if(encoder!=null)encoder.stop();main.post(this::finishReleased);});else finishReleased();
 }
 private void finishReleased(){
  released=true;POLICY.stop(generation);if(thread!=null)thread.quitSafely();stopForeground(true);
  if(destroyed)busy=false;stopSelf();
 }
 @Override public void onDestroy(){destroyed=true;if(released)busy=false;finish("Serviço encerrado.");super.onDestroy();}
}
