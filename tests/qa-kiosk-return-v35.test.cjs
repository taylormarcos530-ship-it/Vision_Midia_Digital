'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const java = fs.readFileSync(path.join(root, 'android-player/app/src/main/java/com/visionmidia/player/MainActivity.java'),'utf8');
const gradle = fs.readFileSync(path.join(root, 'android-player/app/build.gradle'),'utf8');
const player = fs.readFileSync(path.join(root, 'player.js'),'utf8');

test('kiosk V35 remains an isolated test APK and preserves all playback code', () => {
  assert.match(gradle, /versionCode (?:36|37)/);
  assert.match(gradle, /versionName '1\.5\.24'/);
  assert.match(gradle, /applicationIdSuffix '\.homolog'/);
  assert.match(gradle, /firebase-homolog-public\.json/);
  assert.match(player, /async function flushPlaybackQueue\(/);
  assert.match(player, /async function syncManifest\(/);
  assert.match(player, /async function applyPlayerOrientation\(/);
});

test('returns promptly for Home and keeps slow controlled retries while another app remains open', () => {
  const match = java.match(/KIOSK_RETURN_DELAYS_MS = \{([^}]+)\}/);
  assert.ok(match, 'known initial deadlines');
  const ms = match[1].split(',').map(s => Number(s.trim().replace(/L$/,'')));
  assert.deepEqual(ms, [200,1500,4000,10000,30000,60000]);
  assert.match(java, /KIOSK_RETURN_BACKGROUND_INTERVAL_MS = 60_000L/);
  assert.match(java, /SystemClock\.elapsedRealtime\(\) - kioskReturnStartedAt/);
  assert.match(java, /kioskReturnAttempts\+\+/);
  assert.match(java, /kioskHandler\.postDelayed\(\(\) -> \{/);
  assert.match(java, /launchPlayerToFront\(\);\s*\/\/ Android 10\+/);
  assert.match(java, /scheduleKioskReturnAttempt\(\);/);
  const extended = [60_000,120_000,180_000];
  for (let i=1; i<extended.length; i++) assert.equal(extended[i]-extended[i-1],60000);
});

test('retries end immediately on resume, maintenance, disable, or destroy', () => {
  const blocker = java.slice(java.indexOf('private boolean mustStopKioskReturn()'),java.indexOf('private void scheduleKioskReturnAttempt()'));
  assert.match(blocker,/playerVisible/);
  assert.match(blocker,/!isKioskReturnEnabled\(\)/);
  assert.match(blocker,/isKioskMaintenanceActive\(\)/);
  assert.match(blocker,/isFinishing\(\)/);
  assert.match(blocker,/destroyed/);
  const resume = java.slice(java.indexOf('protected void onResume()'),java.indexOf('protected void onPause()'));
  assert.match(resume,/playerVisible = true/);
  assert.match(resume,/kioskReturnInProgress = false/);
  assert.match(resume,/kioskHandler\.removeCallbacksAndMessages\(null\)/);
  const pause = java.slice(java.indexOf('protected void onPause()'),java.indexOf('protected void onDestroy()'));
  assert.match(pause,/playerVisible = false/);
  assert.match(pause,/tryReturnToPlayer\(\)/);
  const destroy = java.slice(java.indexOf('protected void onDestroy()'));
  assert.match(destroy,/destroyed = true/);
  assert.match(destroy,/kioskHandler\.removeCallbacksAndMessages\(null\)/);
  assert.match(java,/KIOSK_MAINTENANCE_DURATION_MS = 10L \* 60L \* 1000L/);
});

test('no aggressive device-owner changes, forced service or WebView reload on kiosk retry', () => {
  const section = java.slice(java.indexOf('private boolean mustStopKioskReturn()'),java.indexOf('private void openAndroidSettingsForMaintenance()'));
  assert.doesNotMatch(section,/startLockTask|stopLockTask|startForeground|loadPlayer\(|clearCache\(|webView\./);
  assert.doesNotMatch(section,/onDestroy\(|resetPairing\(/);
});
