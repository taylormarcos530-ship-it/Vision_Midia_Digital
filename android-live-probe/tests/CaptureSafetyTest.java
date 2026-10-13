package com.visionmidia.liveprobe;
import java.util.Arrays;
public class CaptureSafetyTest {
 static int checks;
 static void check(boolean ok,String reason){checks++;if(!ok)throw new AssertionError(reason);}
 static void size(int w,int h,int a,int b,int x,int y){check(Arrays.equals(CaptureSize.fit(w,h,a,b),new int[]{x,y}),"size "+w+"x"+h);}
 public static void main(String[] args){
  size(1920,1080,2,2,1280,720);size(1080,1920,2,2,720,1280);
  size(1920,1080,16,16,1280,720);size(640,480,2,2,640,480);size(641,479,1,1,640,478);
  boolean rejected=false;try{CaptureSize.fit(0,10,2,2);}catch(IllegalArgumentException e){rejected=true;}check(rejected,"invalid dimensions");
  rejected=false;try{CaptureSize.fit(1,10,2,2);}catch(IllegalArgumentException e){rejected=true;}check(rejected,"too small");
  StringBuilder order=new StringBuilder();CloseStack c=new CloseStack();
  c.add(()->order.append('a'));c.add(()->{order.append('b');throw new IllegalStateException();});c.add(()->order.append('c'));
  check(c.close()==1,"fault count");check(order.toString().equals("cba"),"reverse cleanup survives fault");
  check(c.close()==0,"idempotent cleanup");check(order.toString().equals("cba"),"no duplicate release");
  c.add(()->order.append('d'));check(order.toString().equals("cbad"),"late allocation immediately released");
  check(CaptureSupport.reason(28,true)!=null,"unsupported fps cap fails closed");
  check(CaptureSupport.reason(29,true)==null,"Android 10 supported");
  check(CaptureSupport.reason(35,false)!=null,"stop notification required");
  System.out.println("CaptureSafety: "+checks+" checks passed");
 }
}
