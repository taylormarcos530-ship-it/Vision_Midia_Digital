package com.visionmidia.liveprobe;
public final class CaptureSupport {
 private CaptureSupport(){}
 public static String reason(int sdk,boolean notifications){
  if(sdk<29)return "O ensaio exige Android 10 ou superior para limitar os frames. O Vision Player continua independente.";
  if(!notifications)return "Ative as notificações do Vision Live — Ensaio para disponibilizar a ação Parar.";
  return null;
 }
}
