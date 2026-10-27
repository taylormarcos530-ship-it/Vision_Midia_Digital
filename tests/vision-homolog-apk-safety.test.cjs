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
test('QA boot start is opt-in, kiosk and autostart honor Master, production default unchanged',()=>{
  const boot=fs.readFileSync('android-player/app/src/main/java/com/visionmidia/player/BootReceiver.java','utf8');
  assert.match(build,/bootReceiverEnabled: 'true'/);
  assert.match(manifest, /android:name="\.BootReceiver"\s+android:enabled="\$\{bootReceiverEnabled\}"/);
  assert.match(boot,/Intent\.ACTION_BOOT_COMPLETED/);
  assert.match(boot,/boolean isQa = context\.getPackageName\(\)\.endsWith\("\.homolog"\)/);
  assert.match(boot,/getBoolean\(MainActivity\.KEY_AUTOSTART, !isQa\)/);
  assert.match(boot,/if \(!enabled\) return;/);
  assert.match(boot,/context\.startActivity\(launch\)/);
  assert.doesNotMatch(java,/if \(isHomologationBuild\(\)\) \{[\s\S]{0,160}putBoolean\(KEY_AUTOSTART, false\)/);
  assert.doesNotMatch(java,/if \(isHomologationBuild\(\)\) enabled = false;/);
  assert.match(java,/public void setAutostart\(boolean enabled\) \{[\s\S]{0,260}putBoolean\(KEY_AUTOSTART, enabled\)/);
  assert.match(java,/public void setKioskReturn\(boolean enabled\) \{[\s\S]{0,250}final boolean requestedState = enabled;/);
  assert.match(java,/prefs\.edit\(\)\.putBoolean\(KEY_KIOSK_RETURN, requestedState\)/);
  assert.match(java,/private void openAndroidSettingsForMaintenance\(\)/);
  assert.match(java,/KIOSK_MAINTENANCE_DURATION_MS = 10L \* 60L \* 1000L/);
  assert.match(java,/protected void onPause\(\) \{[\s\S]{0,350}tryReturnToPlayer\(\)/);
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

test('one-time signer setup is local, refuses overwriting a private key',()=>{
  const src=fs.readFileSync('scripts/vision-qa-generate-signing.sh','utf8');
  assert.match(src,/umask 077/);
  assert.match(src,/vision-qa-homolog\.p12/);
  assert.ok(src.includes('if [[ -e "${keypath}" ]]; then'), 'must refuse overwriting keystore');
  assert.match(src,/chmod 600/);
  assert.doesNotMatch(src,/actions\/upload-artifact|github\.com\/.+keystore/);
});

test('owner key generation supports Termux and preserves existing signing identity',()=>{
  const src=fs.readFileSync('scripts/vision-qa-generate-signing.sh','utf8');
  assert.match(src,/pkg install openjdk-17/);
  assert.ok(src.includes('if [[ -L "${keydir}" ]]; then'));
  assert.match(src,/-validity 12000/);
  assert.ok(src.includes('if [[ -e "${keypath}" ]]; then'));
  const gitignore=fs.readFileSync('.gitignore','utf8');
  for(const ext of ['*.p12','*.jks','*.keystore']) assert.ok(gitignore.includes(ext));
});
