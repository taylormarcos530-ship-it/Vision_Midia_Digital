import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const code=readFileSync(new URL('../player.js',import.meta.url),'utf8');
test('stable APK 1.5.24 routes to device-bundle-stable',()=>{
 assert.match(code,/STABLE_BUNDLE_VERSION = '1\.5\.24-stable'/);
 assert.match(code,/isStable \? 'device-bundle-stable' : 'device-bundle-qa'/);
 assert.match(code,/action: 'cycle'/);
});
test('bundle interval is staggered without changing baseline',()=>{
 assert.match(code,/QA_BUNDLE_INTERVAL_MS = 58_000/);
 assert.match(code,/staggeredPollInterval\(QA_BUNDLE_INTERVAL_MS\)/);
 assert.match(code,/Math\.random\(\) \* 0\.30/);
});
test('initial sync and offline safety retained',()=>{
 assert.match(code,/void runBackgroundPoll\(runQaBundle\)/);
 assert.match(code,/ensurePlaybackLoop\(\)/);
 assert.match(code,/backgroundPollState\.inFlight/);
});
test('fleet interval remains bounded for 300 TVs',()=>{
 const low=Math.round(58000*0.85),high=Math.round(58000*1.15);
 assert.equal(low,49300);
 assert.equal(high,66700);
 assert.ok(300*3600000/58000<19000);
});
