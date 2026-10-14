const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.join(process.cwd(),'android-diagnostic-lab');
const src=()=>fs.readFileSync(path.join(dir,'app/src/main/java/com/visionmidia/diagnosticlab/MainActivity.java'),'utf8');
const manifest=()=>fs.readFileSync(path.join(dir,'app/src/main/AndroidManifest.xml'),'utf8');
test('diagnostic has a separate application ID and never replaces the production player',()=>{
 const gradle=fs.readFileSync(path.join(dir,'app/build.gradle'),'utf8');
 assert.match(gradle,/applicationId 'com\.visionmidia\.diagnosticlab'/);
 assert.doesNotMatch(gradle,/applicationId 'com\.visionmidia\.player'/);
 assert.match(manifest(),/Vision Diagnóstico TESTE/);
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
test('Android lab project does not depend on the original Android player',()=>{
 const build=fs.readFileSync(path.join(dir,'build.gradle'),'utf8');
 const app=fs.readFileSync(path.join(dir,'app/build.gradle'),'utf8');
 const settings=fs.readFileSync(path.join(dir,'settings.gradle'),'utf8');
 assert.match(build,/com\.android\.application/);
 assert.match(settings,/include ':app'/);
 assert.doesNotMatch(settings+app,/android-player|com\.visionmidia\.player|implementation /);
});
