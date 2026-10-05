from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'android-player/app/src/main/java/com/visionmidia/player/MainActivity.java'

def method(source, name):
    start = source.index('    private void ' + name + '(')
    opening = source.index('{', start)
    depth = 1
    end = opening + 1
    while depth:
        if source[end] == '{': depth += 1
        if source[end] == '}': depth -= 1
        end += 1
    return source[start:end]

class NativeAudioTests(unittest.TestCase):
    def test_native_mute_and_legacy_output_restore(self):
        source = SOURCE.read_text()
        methods = method(source, 'applyAudioSetting') + '\n' + method(source, 'restorePlayerMusicMute')
        harness = '''
class Context { static final String AUDIO_SERVICE="audio"; }
class AudioManager {
 static final int STREAM_MUSIC=3, ADJUST_MUTE=-100, ADJUST_UNMUTE=100;
 boolean muted=false;
 boolean isStreamMute(int stream){return muted;}
 void adjustStreamVolume(int stream,int action,int flags){muted=action==ADJUST_MUTE;}
}
class WebView { boolean muted=false; }
class WebViewFeature { static final String MUTE_AUDIO="mute"; static boolean supported=true;
 static boolean isFeatureSupported(String f){return supported;} }
class WebViewCompat {static void setAudioMuted(WebView v,boolean muted){v.muted=muted;} }
class Prefs {boolean enabled=true; boolean getBoolean(String key,boolean defaultValue){return enabled;} }
public class NativeAudioHarness {
 static final String KEY_AUDIO_ENABLED="audio_enabled";
 WebView webView=new WebView(); Prefs prefs=new Prefs(); AudioManager audio=new AudioManager();
 boolean mutedMusicByPlayer=false;
 Object getSystemService(String name){return audio;}
 static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
''' + methods + '''
 public static void main(String[] args){
  NativeAudioHarness h=new NativeAudioHarness();
  h.prefs.enabled=false; h.applyAudioSetting(); check(h.webView.muted,"native WebView must mute"); check(!h.audio.muted,"native mode must not alter global output");
  h.prefs.enabled=true; h.applyAudioSetting(); check(!h.webView.muted,"native WebView must unmute");
  WebViewFeature.supported=false; h.prefs.enabled=false; h.applyAudioSetting(); check(h.audio.muted,"legacy output must mute");
  h.restorePlayerMusicMute(); check(!h.audio.muted,"leaving Player must restore output");
  h.applyAudioSetting(); h.prefs.enabled=true; h.applyAudioSetting(); check(!h.audio.muted,"enabling audio must restore output");
  h.audio.muted=true; h.prefs.enabled=false; h.applyAudioSetting(); h.restorePlayerMusicMute(); check(h.audio.muted,"must preserve user existing mute");
  h.prefs.enabled=true; h.applyAudioSetting(); check(h.audio.muted,"must not unmute user existing mute");
 }
}
'''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'NativeAudioHarness.java'
            path.write_text(harness)
            subprocess.run(['java','--module','jdk.compiler/com.sun.tools.javac.Main',str(path)],check=True,capture_output=True)
            subprocess.run(['java','-cp',directory,'NativeAudioHarness'],check=True,capture_output=True)

if __name__ == '__main__': unittest.main()
