'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const gradle=read('android-player/app/build.gradle');
const client=read('player.js');
const server=read('supabase/functions/device-bundle-stable/index.ts');
const existingQa=read('supabase/functions/device-bundle-qa/index.ts');

test('official upgrade preserves signed 1.5.20 package and increments version',()=>{
  assert.match(gradle,/versionCode 37/);
  assert.match(gradle,/versionName '1\.5\.24'/);
  assert.match(gradle,/applicationIdSuffix '\.stable'/);
  const baseline=JSON.parse(read('downloads/Vision-Player.source.json'));
  assert.equal(baseline.application_id,'com.visionmidia.player.stable');
  assert.equal(baseline.version_code,32);
  assert.equal(baseline.signer_sha256,read('android-player/signing-certificate.sha256').trim());
});
test('stable bundling opted in only by native stable package, QA Casa remains isolated',()=>{
  assert.match(client,/STABLE_BUNDLE_VERSION = '1\.5\.24-stable'/);
  assert.match(client,/nativeAppVersion\(\) === STABLE_BUNDLE_VERSION/);
  assert.match(client,/nativeAppVersion\(\) === QA_BUNDLE_VERSION/);
  assert.match(client,/QA_BUNDLE_DEVICE_ID = '45b27442-e0ee-4b79-87fc-c753a52f060c'/);
  assert.match(client,/functionRequest\(bundleRoute/);
  assert.match(client,/device-bundle-stable\.cycle/);
  assert.match(client,/response\?\.device_id !== state\.manifest\?\.device\?\.id/);
  assert.match(client,/startLegacyPollingTimers\(\)/);
  assert.match(client,/QA_BUNDLE_INTERVAL_MS = 58_000/);
});
test('new backend independently authenticates each device and honors blocks',()=>{
  assert.match(server,/STABLE_ANDROID_AGENT = 'VisionPlayerAndroid\/1\.5\.24-stable'/);
  assert.match(server,/const device = await authenticateDevice\(admin, req\)/);
  assert.match(server,/if \(!device\) return json\(\{error:'invalid_device_token'\},401\)/);
  for(const block of ['account_block',"access_block === 'pending'","access_block === 'blocked'","access_block === 'expired'"])assert.ok(server.includes(block));
  assert.doesNotMatch(server,/QA_DEVICE_ID|wrong_qa_device/);
  assert.match(server,/onConflict: 'device_id,client_event_id'/);
  assert.match(server,/response\.commands = await unwrapAction/);
  assert.match(server,/response\.heartbeat = await unwrapAction/);
  assert.match(existingQa,/device\.id !== QA_DEVICE_ID/);
});
