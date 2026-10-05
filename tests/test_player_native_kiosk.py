from pathlib import Path
import subprocess, tempfile, unittest
from test_player_native_audio import method
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'android-player/app/src/main/java/com/visionmidia/player/MainActivity.java'
def lifecycle(s,name):
 start=s.index('    protected void '+name+'('); opening=s.index('{',start); depth=1;end=opening+1
 while depth:
  if s[end]=='{':depth+=1
  if s[end]=='}':depth-=1
  end+=1
 return s[start:end]
class NativeKioskTests(unittest.TestCase):
 def test_return_runs_after_pause_and_respects_panel_and_maintenance(self):
  s=SOURCE.read_text();methods=method(s,'launchPlayerToFront')+'\n'+method(s,'tryReturnToPlayer')+'\n'+lifecycle(s,'onUserLeaveHint')+'\n'+lifecycle(s,'onPause')+'\n'+lifecycle(s,'onResume')
  harness='''
import java.util.*;
class Intent {static final int FLAG_ACTIVITY_NEW_TASK=1,FLAG_ACTIVITY_SINGLE_TOP=2,FLAG_ACTIVITY_CLEAR_TOP=4,FLAG_ACTIVITY_NO_ANIMATION=8,FLAG_ACTIVITY_NO_USER_ACTION=16; int flags;Intent(Object c,Class<?> a){}void addFlags(int f){flags=f;}}
class Handler {List<Runnable> queue=new ArrayList<>();List<Long> delays=new ArrayList<>();void postDelayed(Runnable r,long ms){queue.add(r);delays.add(ms);}void removeCallbacks(Runnable r){queue.remove(r);}void removeCallbacksAndMessages(Object o){queue.clear();}void next(){queue.remove(0).run();}}
class WebView {void onPause(){}void onResume(){}}
class Prefs {long getLong(String k,long d){return d;}Prefs edit(){return this;}Prefs remove(String k){return this;}void apply(){}}
class SystemClock {static long elapsedRealtime(){return 1;}}
class Base {protected void onPause(){}protected void onUserLeaveHint(){}protected void onResume(){}}
class MainActivity extends Base {
 boolean enabled=true,maintenance=false,finishing=false,kioskReturnInProgress=false,watchdogActive=true,playerVisible=true;
 Handler kioskHandler=new Handler(),watchdogHandler=new Handler();Runnable playerWatchdog=()->{};WebView webView=new WebView();
 Prefs prefs=new Prefs();static final String KEY_KIOSK_MAINTENANCE_UNTIL="maintenance";long lastPlayerPulseAt=0;
 void enterImmersiveMode(){}void applyAudioSetting(){}
 int launches=0,flags=0;boolean launchedBeforePause=false;
 static final long KIOSK_RETURN_RETRY_MS=200,KIOSK_RETURN_GUARD_MS=1500;
 boolean isKioskReturnEnabled(){return enabled;}boolean isKioskMaintenanceActive(){return maintenance;}boolean isFinishing(){return finishing;}boolean hasWindowFocus(){return true;}
 void restorePlayerMusicMute(){}void overridePendingTransition(int a,int b){}
 void startActivity(Intent i){launches++;flags=i.flags;launchedBeforePause|=playerVisible;}
 '''+methods+'''
}
public class NativeKioskHarness {
 static void check(boolean v,String m){if(!v)throw new AssertionError(m);}
 public static void main(String[] args){
 MainActivity h=new MainActivity();h.onUserLeaveHint();check(h.launches==0,"must not relaunch before Android completes leaving");h.onPause();check(h.launches==0,"must defer until pause callback finishes");check(!h.kioskHandler.queue.isEmpty(),"Home must schedule native return after pause");check(h.kioskHandler.delays.get(0)<=1000,"return must be prompt, not ten minutes");h.kioskHandler.next();check(h.launches==1,"must relaunch even when TV firmware keeps stale window focus");check((h.flags&Intent.FLAG_ACTIVITY_NEW_TASK)!=0,"bring task forward like working boot path");check(!h.launchedBeforePause,"return only after losing foreground");
 h.onResume();check(h.kioskHandler.queue.isEmpty(),"successful resume must cancel retries");
 for(int mode=0;mode<3;mode++){MainActivity off=new MainActivity();if(mode==0)off.enabled=false;if(mode==1)off.maintenance=true;if(mode==2)off.finishing=true;off.onUserLeaveHint();off.onPause();while(!off.kioskHandler.queue.isEmpty())off.kioskHandler.next();check(off.launches==0,"disabled, maintenance and finishing must not return");}
 MainActivity pending=new MainActivity();pending.onPause();pending.enabled=false;while(!pending.kioskHandler.queue.isEmpty())pending.kioskHandler.next();check(pending.launches==0,"panel disable cancels pending return");
 }
}
'''
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'NativeKioskHarness.java';p.write_text(harness)
   subprocess.run(['java','--module','jdk.compiler/com.sun.tools.javac.Main',str(p)],check=True,capture_output=True)
   r=subprocess.run(['java','-cp',d,'NativeKioskHarness'],capture_output=True,text=True)
   self.assertEqual(r.returncode,0,r.stderr)
