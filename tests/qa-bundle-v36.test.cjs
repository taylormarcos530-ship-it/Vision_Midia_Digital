'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const client = fs.readFileSync(path.join(root,'player.js'),'utf8');
const server = fs.readFileSync(path.join(root,'supabase/functions/device-bundle-qa/index.ts'),'utf8');
const gradle = fs.readFileSync(path.join(root,'android-player/app/build.gradle'),'utf8');
const gateway = fs.readFileSync(path.join(root,'supabase/functions/device-gateway/index.ts'),'utf8');

test('V36 remains isolated; QA bundle is Casa-only and never serves official TVs',()=>{
  assert.match(gradle,/versionCode 36/);
  assert.match(gradle,/versionName '1\.5\.24'/);
  assert.match(gradle,/applicationIdSuffix '\.homolog'/);
  assert.match(client,/QA_BUNDLE_DEVICE_ID = '45b27442-e0ee-4b79-87fc-c753a52f060c'/);
  assert.match(client,/QA_BUNDLE_VERSION = '1\.5\.24-homologacao'/);
  assert.match(client,/nativeAppVersion\(\) === QA_BUNDLE_VERSION/);
  assert.match(server,/QA_ANDROID_AGENT = 'VisionPlayerAndroid\/1\.5\.24-homologacao'/);
  assert.match(server,/device\.id !== QA_DEVICE_ID/);
  assert.match(server,/const device = await authenticateDevice\(admin, req\)/);
  assert.match(server,/const admin = adminClient\(\)/);
  assert.doesNotMatch(gateway,/device-bundle-qa/);
});

test('Master command polling is one cycle under a minute; FCM not assumed',()=>{
  assert.match(client,/QA_BUNDLE_INTERVAL_MS = 58_000/);
  assert.match(client,/QA_BUNDLE_MANIFEST_INTERVAL_MS = 120_000/);
  assert.match(client,/runBackgroundPoll\(runQaBundle\)/);
  assert.match(client,/state\.accessTimer = setInterval\(\(\) => enforceLocalAccess\(\), 1000\)/);
  assert.match(client,/async function pollDeviceCommands\(preloadedCommands = null\)/);
  assert.match(client,/preloadedCommands === null \? await gateway\(\{action:'commands'\}\)/);
  assert.match(server,/response\.commands = await unwrapAction\(await gatewayAction\('commands'\)\)/);
  assert.match(server,/response\.manifest = await unwrapAction\(await gatewayAction\('manifest'/);
  assert.match(server,/if \(body\.include_manifest === true\)/);
});

test('proofs and events remain individually idempotent; only acknowledged IDs can leave cache',()=>{
  assert.match(client,/const proofs = playbackQueue\(\)\.slice\(0, 50\)/);
  assert.match(client,/const events = deviceEventQueue\(\)\.slice\(0, 25\)/);
  assert.match(client,/response\.proofs\?\.ok && response\.proofs\.data\?\.accepted === proofs\.length/);
  assert.match(client,/response\.events\?\.ok && response\.events\.data\?\.accepted === events\.length/);
  assert.match(client,/const pending = latest\.filter\(event => !confirmed\.has\(event\.client_event_id\)\)/);
  assert.match(server,/ignoreDuplicates: true/);
  assert.match(server,/onConflict: 'device_id,client_event_id'/);
  assert.match(server,/gatewayAction\('playback_batch'/);
  assert.match(server,/action:'event_batch'/);
  assert.match(server,/body\.proofs\.length > 50/);
  assert.match(server,/body\.events\.length > 25/);
});

test('unchanged commands, monitor, and manifest server logic remain onboard',()=>{
  assert.match(server,/async function resolveProgram\(/);
  assert.match(server,/async function loadPlaylistPayload\(/);
  assert.match(server,/return json\(\{ ok:true, commands: commands \|\| \[\] \}\)/);
  assert.match(server,/\.from\('device_heartbeats'\)/);
  assert.match(server,/\.from\('playback_logs'\)/);
  assert.match(server,/\.from\('device_events'\)/);
  assert.match(server,/clock_skew_ms/);
  assert.match(server,/access_block === 'expired'/);
  assert.match(server,/account_block/);
  assert.doesNotMatch(server,/fetch\('https:\/\/.*functions\/v1/);
});

test('if dedicated QA endpoint is absent, old V35 polling is retained',()=>{
  assert.match(client,/state\.qaBundleSupported = false/);
  assert.match(client,/startLegacyPollingTimers\(\)/);
  assert.match(client,/Number\(error\?\.status\) === 404/);
  assert.match(client,/if \(Number\(error\?\.status\) === 401\)/);
  assert.match(client,/state\.serverAccessDenied = true/);
  assert.match(client,/await syncManifest\(response\.manifest\.data\)/);
  assert.match(client,/await pollDeviceCommands\(response\.commands\.data\.commands\)/);
  assert.ok(client.indexOf('await pollDeviceCommands(response.commands.data.commands)') < client.indexOf('await syncManifest(response.manifest.data)'));
  assert.match(client,/if \(state\.accessTimer\) clearInterval\(state\.accessTimer\)/);
  assert.match(client,/countRequestAttempt\('device-bundle-qa', 'cycle'\)/);
  assert.match(client,/'device-bundle-qa.cycle'/);
});

test('one scheduled Edge invocation per minute is a target, not a claim of DB cost reduction',()=>{
  const scheduled = 60*60*1000/58_000;
  assert.ok(scheduled>60 && scheduled<63);
  const baseline=220;
  const theoreticalSaving=(1-scheduled/baseline)*100;
  assert.ok(theoreticalSaving>70 && theoreticalSaving<80);
});
