package com.visionmidia.liveprobe;
public final class CaptureSize {
 private CaptureSize(){}
 public static int[] fit(int w,int h,int aw,int ah){
  if(w<2||h<2||aw<1||ah<1)throw new IllegalArgumentException("Invalid dimensions");
  aw=Math.multiplyExact(aw,aw%2==0?1:2);ah=Math.multiplyExact(ah,ah%2==0?1:2);
  double scale=Math.min(1,Math.min((w>=h?1280.0:720.0)/w,(w>=h?720.0:1280.0)/h));
  int width=(int)(w*scale)/aw*aw,height=(int)(h*scale)/ah*ah;
  if(width<2||height<2)throw new IllegalArgumentException("Dimensions below encoder alignment");
  return new int[]{width,height};
 }
}
