const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.join(process.cwd(),'android-diagnostic-lab');
const src=()=>fs.readFileSync(path.join(dir,'app/src/main/java/com/visionmidia/diagnosticlab/MainActivity.java'),'utf8');
const manifest=()=>fs.readFileSync(path.join(dir,'app/src/main/AndroidManifest.xml'),'utf8');
test('diagnostic has a separate application ID and never replaces the production player',()=>{
 const gradle=fs.readFileSync(path.join(dir,'app/build.gradle'),'utf8');
 assert.match(gradle,/applicationId 'com\.visionmidia\.diagnosticlab\.v05'/);
 assert.doesNotMatch(gradle,/applicationId 'com\.visionmidia\.player'/);
 assert.match(manifest(),/Vision Diagnóstico TESTE 0.5/);
 assert.match(manifest(),/LEANBACK_LAUNCHER/);
});
test('no Android privileges, boot receivers, services, or production network clients',()=>{
 const xml=manifest(),java=src();
 assert.doesNotMatch(xml,/<uses-permission|android\.permission\.|RECEIVE_BOOT_COMPLETED/);
 assert.doesNotMatch(xml,/<service|<receiver/);
 assert.doesNotMatch(java,/BootReceiver|startService|HttpsURLConnection|HttpURLConnection|WebView/);
 assert.doesNotMatch(java,/supabase|gateway|visionmidiadigitalgo|createClient|fetch\(/i);
});
test('native Android app contains guarded offline reconnect and restart simulation',()=>{
 const code=src();
 assert.match(code,/handler\.postDelayed\(activeTask,3000\)/);
 assert.match(code,/handler\.postDelayed\(activeTask,2000\)/);
 assert.match(code,/expected!=generation/);
 assert.match(code,/onPause\(\)/);
 assert.match(code,/running=resumeOnConnection/);
 assert.match(code,/round\+\+/);
 assert.match(code,/video\.setOnCompletionListener/);
 assert.match(code,/video\.setOnErrorListener/);
});
test('tiny bundled H264 mp4 is valid binary base64 and does not depend on internet',()=>{
 const encoded=fs.readFileSync(path.join(dir,'app/src/main/assets/sample_h264_baseline.b64'),'utf8').trim();
 const buf=Buffer.from(encoded,'base64');
 assert.ok(buf.length>1000&&buf.length<25000);
 assert.equal(buf.toString('ascii',4,8),'ftyp');
 assert.match(buf.toString('ascii'),/avc1/);
 assert.doesNotMatch(src(),/http:\/\/|https:\/\//);
});
test('v0.3 retains full-screen command moves the original stage and restores it without altering playback state',()=>{
 const code=src();
 assert.match(code,/private void fullscreen\(\)/);
 assert.match(code,/stageParent\.removeView\(frame\)/);
 assert.match(code,/overlay\.addView\(frame,new FrameLayout\.LayoutParams/);
 assert.match(code,/ViewGroup\.LayoutParams\.MATCH_PARENT,ViewGroup\.LayoutParams\.MATCH_PARENT/);
 assert.match(code,/Theme_Black_NoTitleBar_Fullscreen/);
 assert.match(code,/SAIR DA TELA CHEIA/);
 assert.match(code,/dialog\.setOnDismissListener/);
 assert.match(code,/stageParent\.addView\(frame,/);
 assert.match(code,/dialog\.show\(\)/);
 assert.doesNotMatch(code,/root\.getSystemUiVisibility\(\)==flags/);
});
test('H.264 decoder outcome remains visible after short blue sample returns to normal program',()=>{
 const code=src();
 assert.match(code,/if \(!videoMode\) return true/);
 assert.match(code,/MP4 CONCLUÍDO/);
 assert.match(code,/ERRO DE VÍDEO/);
 assert.match(code,/videoIndicator\.setVisibility\(View\.VISIBLE\)/);
 assert.match(code,/video\.setOnCompletionListener/);
 assert.match(code,/video\.setOnErrorListener/);
 assert.match(code,/if \(!videoMode\) return;/);
});
test('revised test APK installs alongside older debug signer and production player',()=>{
 const gradle=fs.readFileSync(path.join(dir,'app/build.gradle'),'utf8');
 assert.match(gradle,/applicationId 'com\.visionmidia\.diagnosticlab\.v05'/);
 assert.match(gradle,/versionCode 5/);
 assert.match(gradle,/versionName '0\.5-laboratorio'/);
 assert.doesNotMatch(gradle,/applicationId 'com\.visionmidia\.diagnosticlab'\s*$/m);
 assert.doesNotMatch(gradle,/applicationId 'com\.visionmidia\.player'/);
});
test('MP4 completion or error banner automatically disappears after 3 seconds',()=>{
 const java=src();
 assert.match(java,/private Runnable videoMessageHideTask/);
 assert.match(java,/private void scheduleVideoMessageHide\(\)/);
 assert.match(java,/handler\.postDelayed\(videoMessageHideTask,3000\)/);
 assert.match(java,/videoIndicator\.setVisibility\(View\.GONE\)/);
 const occurrences=(java.match(/scheduleVideoMessageHide\(\);/g)||[]).length;
 assert.equal(occurrences,3,'success, error, preparation failure must all dismiss');
 assert.match(java,/mediaReport\.setText\("✓ MP4 H\.264 CONCLUÍDO/);
 assert.match(java,/private void cancelVideoMessageHide\(\)/);
 assert.match(java,/handler\.removeCallbacks\(videoMessageHideTask\)/);
 assert.match(java,/private void stopVideo\(\) \{\s*cancelVideoMessageHide\(\)/);
 assert.match(java,/@Override protected void onPause\(\) \{[\s\S]*?cancelVideoMessageHide\(\)/);
});
test('MP4 message timeout cannot affect playlist generation or simulated reconnect timers',()=>{
 const java=src();
 const timerBlock=java.slice(java.indexOf('private void scheduleVideoMessageHide()'),
  java.indexOf('private void stopVideo()'));
 assert.doesNotMatch(timerBlock.replace(/\/\/[^\n]*/g,''),/\bgeneration\b|activeTask|completed\+\+|current\+\+|round\+\+|advanceLater\(/);
 assert.match(timerBlock,/handler\.postDelayed\(videoMessageHideTask,3000\)/);
 assert.match(java,/handler\.postDelayed\(activeTask,3000\)/);
 assert.match(java,/handler\.postDelayed\(activeTask,2000\)/);
});
test('Android lab project does not depend on the original Android player',()=>{
 const build=fs.readFileSync(path.join(dir,'build.gradle'),'utf8');
 const app=fs.readFileSync(path.join(dir,'app/build.gradle'),'utf8');
 const settings=fs.readFileSync(path.join(dir,'settings.gradle'),'utf8');
 assert.match(build,/com\.android\.application/);
 assert.match(settings,/include ':app'/);
 assert.doesNotMatch(settings+app,/android-player|com\.visionmidia\.player|implementation /);
});

test('v0.4 isolated native mode maps six point videos and two raster ads at items 4 and 8',()=>{
 const java=fs.readFileSync(path.join(dir,'app/src/main/java/com/visionmidia/diagnosticlab/MediaRotationActivity.java'),'utf8');
 assert.match(java,/private static final int\[\] SEQUENCE = \{0,1,2,-1,3,4,5,-2\}/);
 assert.match(java,/private static final String\[\] BASE/);
 assert.match(java,/Bitmap\.createBitmap\(960,540,Bitmap\.Config\.ARGB_8888\)/);
 assert.match(java,/ImageView\.ScaleType\.FIT_CENTER/);
 assert.match(java,/PUBLICIDADE FICTÍCIA/);
 assert.match(java,/EMPRESA A/);
 assert.match(java,/EMPRESA B/);
 const xml=manifest();
 assert.match(xml,/<activity\s+android:name="\.MediaRotationActivity"\s+android:exported="false"/);
 assert.match(src(),/startActivity\(new Intent\(this,MediaRotationActivity\.class\)\)/);
 assert.match(src(),/INTERCALAR MP4 \+ IMAGENS/);
});
test('native video waits for real decoder completion and drops stale callbacks',()=>{
 const java=fs.readFileSync(path.join(dir,'app/src/main/java/com/visionmidia/diagnosticlab/MediaRotationActivity.java'),'utf8');
 assert.match(java,/video\.setOnPreparedListener\(mp->/);
 assert.match(java,/video\.setOnCompletionListener\(mp->/);
 assert.match(java,/video\.setOnErrorListener\(\(mp,what,extra\)->/);
 assert.match(java,/if\(token!=generation\|\|!running\|\|!prepared\|\|failed\)return;/);
 assert.match(java,/completeCurrent\(\); \/\/ NEVER a timer for MP4/);
 assert.match(java,/void fail\(String message\)/);
 assert.match(java,/running=false;failed=true;prepared=false;/);
 assert.match(java,/video\.stopPlayback\(\)/);
 assert.match(java,/handler\.postDelayed\(timer,2000\)/);
 const onVideo=java.slice(java.indexOf('video.setOnCompletionListener'),java.indexOf('video.setOnErrorListener'));
 assert.doesNotMatch(onVideo,/postDelayed|completed\+\+/);
 assert.doesNotMatch(java,/\bfetch\(|HttpsURLConnection|OkHttpClient|WebView|Supabase/);
});
test('native lab recovery simulates outage without writing playback logs',()=>{
 const java=fs.readFileSync(path.join(dir,'app/src/main/java/com/visionmidia/diagnosticlab/MediaRotationActivity.java'),'utf8');
 assert.match(java,/handler\.postDelayed\(timer,3000\)/);
 assert.match(java,/handler\.postDelayed\(timer,2000\)/);
 assert.match(java,/private void pausePlayback\(\)/);
 assert.match(java,/private void restart\(\)/);
 assert.match(java,/private void drop\(\)/);
 assert.match(java,/private void reset\(\)/);
 assert.match(java,/void onPause\(\)/);
 assert.match(java,/void onDestroy\(\)/);
 assert.doesNotMatch(java,/SharedPreferences|localStorage|System\.out\.println|Log\.d|sendBeacon/);
});

test('pausing the same raster advertisement never counts it as a second visit',()=>{
 const java=fs.readFileSync(path.join(dir,'app/src/main/java/com/visionmidia/diagnosticlab/MediaRotationActivity.java'),'utf8');
 assert.match(java,/private boolean adVisitCounted=false;/);
 assert.match(java,/if\(!adVisitCounted\)\{commercialsShown\+\+;adVisitCounted=true;\}/);
 assert.match(java,/concluded\+\+;\s*adVisitCounted=false;\s*itemIndex\+\+;/);
 assert.match(java,/itemIndex=0;round=1;concluded=0;commercialsShown=0;clipPosition=0;\s*adVisitCounted=false;/);
});
