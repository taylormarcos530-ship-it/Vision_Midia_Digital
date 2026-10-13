package com.visionmidia.liveprobe;

import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.media.projection.MediaProjection;
import android.os.Handler;
import android.os.SystemClock;
import android.view.Display;
import android.view.Surface;

/** Single-use capture. All calls and callbacks belong to one worker looper. */
public final class CaptureEncoder {
 public interface Listener {
  void onConfigured(String codec,int width,int height);
  void onStats(long frames,long bytes,long elapsedMs);
  void onError(String reason);
 }
 private final Handler worker;
 private final DisplayManager displays;
 private final CloseStack resources=new CloseStack();
 private MediaCodec codec;
 private Listener listener;
 private boolean used,running;
 private long started,reported,frames,bytes;
 public CaptureEncoder(Handler worker,DisplayManager displays){this.worker=worker;this.displays=displays;}
 public void start(MediaProjection projection,int width,int height,int density,Listener listener){
  if(used)throw new IllegalStateException("Capture cannot be reused");
  used=true;this.listener=listener;resources.add(projection::stop);
  try {
   MediaProjection.Callback callback=new MediaProjection.Callback(){
    @Override public void onStop(){fail("Compartilhamento encerrado pelo Android.");}
    @Override public void onCapturedContentResize(int w,int h){
     if(w!=width||h!=height)fail("A região ou orientação mudou. Inicie outro ensaio.");
    }
   };
   projection.registerCallback(callback,worker);resources.add(()->projection.unregisterCallback(callback));
   Display initial=displays.getDisplay(Display.DEFAULT_DISPLAY);
   if(initial==null)throw new IllegalStateException("Display unavailable");
   int rotation=initial.getRotation();
   DisplayManager.DisplayListener displayListener=new DisplayManager.DisplayListener(){
    public void onDisplayAdded(int id){}
    public void onDisplayRemoved(int id){if(id==Display.DEFAULT_DISPLAY)fail("Tela desconectada.");}
    public void onDisplayChanged(int id){
     if(id!=Display.DEFAULT_DISPLAY)return;
     Display d=displays.getDisplay(id);
     if(d==null||d.getRotation()!=rotation)fail("Orientação alterada. Inicie outro ensaio.");
    }
   };
   displays.registerDisplayListener(displayListener,worker);resources.add(()->displays.unregisterDisplayListener(displayListener));
   MediaFormat format=null;String name=null;int[] size=null;
   for(MediaCodecInfo info:new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()){
    if(!info.isEncoder())continue;
    boolean avc=false;for(String type:info.getSupportedTypes())if(type.equalsIgnoreCase("video/avc"))avc=true;
    if(!avc)continue;
    MediaCodecInfo.CodecCapabilities caps=info.getCapabilitiesForType("video/avc");
    boolean surface=false;for(int color:caps.colorFormats)if(color==MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)surface=true;
    if(!surface)continue;
    MediaCodecInfo.VideoCapabilities video=caps.getVideoCapabilities();
    int[] candidate=CaptureSize.fit(width,height,video.getWidthAlignment(),video.getHeightAlignment());
    MediaFormat f=MediaFormat.createVideoFormat("video/avc",candidate[0],candidate[1]);
    f.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
    f.setInteger(MediaFormat.KEY_BIT_RATE,800000);f.setInteger(MediaFormat.KEY_FRAME_RATE,10);
    f.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,2);
    if(!caps.isFormatSupported(f))continue;
    f.setFloat(MediaFormat.KEY_MAX_FPS_TO_ENCODER,10f);
    name=info.getName();format=f;size=candidate;break;
   }
   if(name==null)throw new IllegalStateException("No compatible H.264 surface encoder");
   final MediaCodec allocated=MediaCodec.createByCodecName(name);codec=allocated;resources.add(allocated::release);
   allocated.configure(format,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);
   Surface surface=allocated.createInputSurface();resources.add(surface::release);
   allocated.start();resources.add(allocated::stop);
   VirtualDisplay display=projection.createVirtualDisplay("VisionLiveProbe",size[0],size[1],density,DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,surface,null,worker);
   if(display==null)throw new IllegalStateException("Virtual display unavailable");
   resources.add(display::release);
   running=true;started=SystemClock.elapsedRealtime();reported=started;
   listener.onConfigured(name,size[0],size[1]);worker.post(drain);
  }catch(Exception error){stop();listener.onError("Captura indisponível: "+error.getClass().getSimpleName()+" — "+error.getMessage());}
 }
 private final Runnable drain=new Runnable(){
  public void run(){
   if(!running)return;
   try{
    MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
    for(int i=0;i<8;i++){
     int index=codec.dequeueOutputBuffer(info,0);
     if(index==MediaCodec.INFO_TRY_AGAIN_LATER)break;
     if(index>=0){
      if(info.size>0&&(info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)==0){frames++;bytes+=info.size;}
      codec.releaseOutputBuffer(index,false);
     }
    }
    long now=SystemClock.elapsedRealtime();
    if(now-started>=SessionPolicy.CAPTURE_TIMEOUT_MS){fail("Limite de três minutos atingido.");return;}
    if(frames==0&&now-started>=10000){fail("Encoder sem frames por dez segundos.");return;}
    if(now-reported>=1000){reported=now;listener.onStats(frames,bytes,now-started);}
    worker.postDelayed(this,20);
   }catch(RuntimeException error){fail("Falha no encoder: "+error.getClass().getSimpleName());}
  }
 };
 private void fail(String reason){if(!running)return;stop();listener.onError(reason);}
 public void stop(){running=false;worker.removeCallbacks(drain);resources.close();codec=null;}
}
