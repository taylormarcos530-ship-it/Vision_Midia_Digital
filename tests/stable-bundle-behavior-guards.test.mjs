import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../player.js',import.meta.url),'utf8');
const startup=src.slice(src.indexOf('async function startPlayer()'),src.indexOf('function startLegacyPollingTimers()'));
const bundle=src.slice(src.indexOf('async function runQaBundle()'),src.indexOf('function shuffled('));
test('invalid clock and incomplete cache cannot enter delayed path',()=>{
 assert.match(startup,/localAccessState\(\) === 'valid'/);
 assert.match(startup,/media\.length !== state\.manifest\.items\.length/);
 assert.match(startup,/response\.headers\.get\('Content-Length'\)/);
 assert.match(startup,/if \(!complete/);
 assert.match(startup,/startBundleImmediately\(\)/);
});
test('network failure retains offline media and retry gate',()=>{
 assert.match(src,/if \(!state\.deviceToken \|\| !navigator\.onLine \|\| backgroundPollState\.inFlight/);
 assert.match(startup,/ensurePlaybackLoop\(\)/);
 assert.match(bundle,/preservando filas locais/);
});
test('pairing changed during async cache lookup or timer suppresses stale request',()=>{
 assert.match(startup,/state\.deviceToken !== pairedToken/);
 assert.match(startup,/state\.manifest\?\.device\?\.id !== pairedDeviceId/);
 assert.match(startup,/state\.deviceToken === pairedToken/);
});
test('native push bypasses delay and clears only after acknowledged commands',()=>{
 assert.match(startup,/consumePushSignal\?\.\(\) === true/);
 assert.match(startup,/clearTimeout\(state\.syncTimer\)/);
 assert.match(startup,/void runBackgroundPoll\(runQaBundle\)/);
 const ack=bundle.indexOf('response.commands?.ok');
 const clear=bundle.lastIndexOf('state.pushPending = false');
 assert.ok(ack>=0&&clear>ack);
});
test('startup retains immediate path for unpaired or uncached',()=>{
 assert.match(startup,/if \(!state\.deviceToken\) return startPairing\(\)/);
 assert.match(startup,/else \{\s*startBundleImmediately\(\);\s*\}\s*return/);
});
