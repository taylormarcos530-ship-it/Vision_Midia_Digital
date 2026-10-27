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

test('stable QA signing requires externally provided private keystore',()=>{
  assert.match(build,/VISION_QA_KEYSTORE_FILE/);
  assert.match(build,/VISION_QA_KEYSTORE_PASSWORD/);
  assert.match(build,/VISION_QA_KEY_ALIAS/);
  assert.match(build,/VISION_QA_KEY_PASSWORD/);
  assert.match(build,/if \(qaStableSigningReady\) \{\s*signingConfig signingConfigs\.qaStable/);
  assert.doesNotMatch(build, /storePassword ['"][^'"]+['"]/);
  assert.doesNotMatch(build, /keyPassword ['"][^'"]+['"]/);
});
test('smoke-build workflow deliberately refuses to publish throwaway signed APKs',()=>{
  const pipeline=fs.readFileSync('.github/workflows/vision-supabase-free-traffic-isolated.yml','utf8');
  assert.doesNotMatch(pipeline,/actions\/upload-artifact/);
  assert.match(pipeline,/ephemeral debug-signed APK cannot update/);
});
test('local QA signing refuses to build when private key material is absent',()=>{
  const script='scripts/vision-qa-signing-check.sh';
  const src=fs.readFileSync(script,'utf8');
  assert.match(src,/VISION_QA_EXPECTED_CERT_SHA256/);
  assert.match(src,/Refusing distribution/);
  const {spawnSync}=require('node:child_process');
  const result=spawnSync('bash',[script],{
    encoding:'utf8',env:{PATH:process.env.PATH}
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Stable private keystore file is required/);
});
