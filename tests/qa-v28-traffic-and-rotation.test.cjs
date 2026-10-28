'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const gateway = fs.readFileSync(path.join(root, 'supabase/functions/device-gateway/index.ts'), 'utf8');
const player = fs.readFileSync(path.join(root, 'player.js'), 'utf8');

function extractFunction(source, declaration) {
  const start = source.indexOf(declaration);
  assert.ok(start >= 0, 'Missing function: ' + declaration);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, 'Missing closing boundary: ' + declaration);
  return source.slice(start, end + 2);
}
function signedUrlHarness() {
  let now = 10_000;
  let calls = 0;
  const fakeDate = { now: () => now };
  const cache = new Map();
  const inflight = new Map();
  const factory = new Function('Date','mediaSignedUrlCache','mediaSignedUrlInFlight',
    'MEDIA_SIGNED_URL_TTL_SECONDS','MEDIA_SIGNED_URL_REUSE_MS','MEDIA_SIGNED_URL_CACHE_MAX',
    extractFunction(gateway, 'async function cachedSignedMediaUrl(') +
      '\nreturn cachedSignedMediaUrl;');
  const signed = factory(fakeDate, cache, inflight, 21600, 5*60*60*1000, 256);
  let fail = false;
  let pending = null;
  const admin = { storage: { from(bucket) {
    assert.equal(bucket, 'vision-media');
    return { async createSignedUrl(storagePath, ttlSeconds) {
      assert.equal(ttlSeconds, 21600);
      calls++;
      if (pending) await pending;
      if (fail) return { data:null, error:new Error('signed URL failed') };
      return { data:{signedUrl:'signed://'+storagePath+'/'+calls}, error:null };
    } };
  } } };
  return { signed, admin, cache, inflight, advance(ms){now+=ms}, get calls(){return calls},
    fail(value){fail=value}, delay(promise){pending=promise} };
}

test('V28: repeated signed URL stays in same instance cache', async () => {
  const h = signedUrlHarness();
  const asset = { storage_path:'company/media1.mp4',updated_at:'r1',checksum_sha256:'sha1' };
  const first = await h.signed(h.admin,asset);
  const again = await h.signed(h.admin,asset);
  assert.equal(first,again);
  assert.equal(h.calls,1);
});

test('V28: same file revision expiry forces a fresh signed URL', async () => {
  const h=signedUrlHarness(), asset={storage_path:'company/media.mp4',updated_at:'r1'};
  await h.signed(h.admin,asset);
  h.advance(5*60*60*1000 + 1);
  await h.signed(h.admin,asset);
  assert.equal(h.calls,2);
});
test('V28: changed revision or another company cannot reuse a link', async () => {
  const h=signedUrlHarness();
  await h.signed(h.admin,{storage_path:'companyA/clip.mp4',updated_at:'r1'});
  await h.signed(h.admin,{storage_path:'companyA/clip.mp4',updated_at:'r2'});
  await h.signed(h.admin,{storage_path:'companyB/clip.mp4',updated_at:'r1'});
  assert.equal(h.calls,3);
});
test('V28: signing failure is not cached and can recover', async () => {
  const h=signedUrlHarness(),asset={storage_path:'company/media.mp4'};
  h.fail(true);
  await assert.rejects(h.signed(h.admin,asset));
  h.fail(false);
  assert.ok(await h.signed(h.admin,asset));
  assert.equal(h.calls,2);
  assert.equal(h.inflight.size,0);
});
test('V28: parallel requests share only one signing in flight', async () => {
  const h=signedUrlHarness(),asset={storage_path:'company/same.mp4'};
  let release;
  h.delay(new Promise(resolve=>{release=resolve}));
  const a=h.signed(h.admin,asset);
  const b=h.signed(h.admin,asset);
  release();
  assert.equal(await a, await b);
  assert.equal(h.calls,1);
});

test('V28: previously sent commands are not updated on each poll', () => {
  assert.match(gateway,/filter\(row => row\.status === 'pending'\)/);
  assert.match(gateway,/\.eq\('status', 'pending'\)\.in\('id', pendingIds\)/);
  assert.match(gateway,/\.in\('status', \['pending','sent'\]\)/);
});
test('V28: offline startup applies device-scoped cached rotation before playback', () => {
  const start=player.indexOf('async function startPlayer()');
  const display=player.indexOf('await applyStartupPresentation(state.manifest)',start);
  const playback=player.indexOf('ensurePlaybackLoop()',start);
  assert.ok(start>0 && display>start && playback>display);
  const helper=extractFunction(player,'async function applyStartupPresentation(');
  assert.match(helper,/screen_rotation_degrees/);
  assert.match(helper,/setDisplayRotation/);
  assert.match(helper,/dataset\.screenRotationDegrees/);
  assert.doesNotMatch(helper,/caches\.delete/);
});
test('V28: safety barriers on background polling and proof batches remain', () => {
  assert.match(player,/backgroundPollState\.inFlight/);
  assert.match(player,/playbackFlushInFlight/);
  assert.match(player,/confirmed\.has\(event\.client_event_id\)/);
  assert.match(player,/heartbeat: 60_000/);
  assert.match(player,/manifest: 120_000/);
  assert.match(player,/commands: 45_000/);
});

test('V28: nominal scheduled request reduction stays in 84%-87% target vs legacy', () => {
  // 1080/h is the documented old polling baseline, not a measured cost.
  // This test deliberately does NOT claim an 84%-87% reduction in actual
  // Supabase REST, Storage, function invocations or billing.
  const intervalBlock = player.match(/BACKGROUND_POLL_INTERVALS = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)/);
  assert.ok(intervalBlock, 'Missing periodic polling configuration');
  function interval(label) {
    const m = intervalBlock[1].match(new RegExp(label + ':\\\\s*([\\\\d_]+)'));
    assert.ok(m, 'Missing interval: ' + label);
    return Number(m[1].replaceAll('_', ''));
  }
  const hourlyNominal = ['heartbeat','manifest','commands']
    .reduce((sum, action) => sum + 3_600_000 / interval(action), 0);
  const legacyNominal = 1080;
  const reductionPercent = 100 * (1 - hourlyNominal / legacyNominal);
  assert.ok(reductionPercent >= 84 && reductionPercent <= 87,
    'Nominal polling reduction is ' + reductionPercent.toFixed(2) + '%');
  assert.equal(hourlyNominal, 170);
});

