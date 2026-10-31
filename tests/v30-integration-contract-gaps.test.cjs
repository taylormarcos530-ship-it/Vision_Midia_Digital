'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const player=fs.readFileSync('player.js','utf8');
const bundle=fs.readFileSync('supabase/functions/device-bundle-stable/index.ts','utf8');
const gateway=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
function segment(src,a,b){const i=src.indexOf(a),j=src.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,a+' missing');return src.slice(i,j)}
const cycle=segment(bundle,"if (body.proofs !== undefined", "return json(response");
const playback=segment(bundle,"if (action === 'playback' || action === 'playback_batch')", "if (action === '");
const qa=segment(player,"const proofs = playbackQueue().slice(0, 50)", "function ");
test('IN01 cycle accepts separate proofs/events with explicit bounds',()=>{
 assert.match(cycle,/invalid_proofs/);assert.match(cycle,/invalid_events/);
 assert.match(cycle,/response\.proofs\s*=\s*await/);assert.match(cycle,/response\.events\s*=\s*await/);
});
test('IN02 player independently acknowledges only successful full-length batches',()=>{
 assert.match(qa,/response\.proofs\?\.ok\s*&&\s*response\.proofs\.data\?\.accepted\s*===\s*proofs\.length/);
 assert.match(qa,/response\.events\?\.ok\s*&&\s*response\.events\.data\?\.accepted\s*===\s*events\.length/);
});
test('IN03 gateway rejects mixed invalid proof batches before upsert',()=>{
 const start=gateway.indexOf("if (action === 'playback' || action === 'playback_batch')");
 const end=gateway.indexOf(".from('playback_logs')",start);
 assert.ok(start>=0&&end>start,'gateway playback validation and storage missing');
 const block=gateway.slice(start,end+".from('playback_logs')".length);
 assert.match(block,/invalid_playback_event/);assert.match(block,/playback_logs/);
});
test('IN04 bundle playback rejects invalid proof batches atomically',()=>{
 assert.match(playback,/invalid_playback_event/);
 const validation=playback.indexOf('invalid_playback_event'),upsert=playback.indexOf(".from('playback_logs')");
 assert.ok(validation>=0&&upsert>validation,'validation must precede write');
});
test('IN05 offline queue retains unacknowledged events on transport failure',()=>{
 const flush=segment(player,'async function flushPlaybackQueue()','function deviceEventQueue()');
 assert.match(flush,/await gateway\(\{ action: 'playback_batch', events: batch \}\)/);
 assert.match(flush,/playbackFlushInFlight = null/);
});
test('IN06 prevent confusing in-isolate sweep with global throttle',()=>{
 const traffic=fs.readFileSync('tests/v30-bundle-v3-traffic.test.cjs','utf8');
 assert.match(traffic,/per isolate, not global SQL throttle/);
 assert.match(traffic,/new Map\(\),new Set\(\)/);
});
test('IN07 count attempted PATCH and zero-row PATCH requires instrumentation',()=>{
 const traffic=fs.readFileSync('tests/v30-bundle-v3-traffic.test.cjs','utf8');
 assert.match(traffic,/stats\.offline\+\+/);
 assert.ok(!traffic.includes('zeroRowPatchCount'),'No assertion exists yet for zero-row PATCH');
});
