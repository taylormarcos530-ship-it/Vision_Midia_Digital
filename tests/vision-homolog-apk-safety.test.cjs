const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const build=fs.readFileSync('android-player/app/build.gradle','utf8');
const manifest=fs.readFileSync('android-player/app/src/main/AndroidManifest.xml','utf8');
const java=fs.readFileSync('android-player/app/src/main/java/com/visionmidia/player/MainActivity.java','utf8');
test('QA package is separate and distinctly identified',()=>{
  assert.match(build,/homolog\s*\{[\s\S]*?applicationIdSuffix '\.homolog'/);
  assert.match(build,/playerLabel: 'Vision TESTE \(nao oficial\)'/);
  assert.match(build,/setupScheme: 'visionmidia-homolog'/);
  assert.match(java,/getPackageName\(\)\.endsWith\("\.homolog"\)/);
});
test('QA variant disables boot start and kiosk/autostart',()=>{
  assert.match(build,/bootReceiverEnabled: 'false'/);
  assert.match(manifest, /android:name="\.BootReceiver"\s+android:enabled="\$\{bootReceiverEnabled\}"/);
  assert.match(java,/if \(isHomologationBuild\(\)\) \{\s*prefs\.edit\(\)\.putBoolean\(KEY_AUTOSTART, false\)/);
  assert.match(java,/public void setAutostart\(boolean enabled\) \{\s*if \(isHomologationBuild\(\)\) enabled = false;/);
  assert.match(java,/public void setKioskReturn\(boolean enabled\) \{\s*if \(isHomologationBuild\(\)\) enabled = false;/);
});
test('QA app cannot request official APK upgrade from Android bridge',()=>{
  assert.match(java,/public boolean requestApkUpdate\(String downloadUrl\) \{\s*if \(isHomologationBuild\(\)\) return false;/);
});
