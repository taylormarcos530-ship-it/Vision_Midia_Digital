'use strict';
// Golden source fingerprint from an explicitly read-only capture of deployed
// device-gateway v22 (sha256 80818c961a873df1e1953242fb92d2f5e793b2b064590bf88877586d91ce3031).
// The gateway may diverge ONLY in playback/playback_batch until user authorizes
// further behavior changes. FNV-1a is a drift detector, NOT a crypto signature.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const src=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
const start="    if (action === 'playback' || action === 'playback_batch') {";
const end="      return json({ ok: true, accepted: rows.length })\n    }";
function splitSections(){
 const i=src.indexOf(start);
 const j=src.indexOf(end,i);
 assert.ok(i>0 && j>i,'Playback route layout changed');
 assert.equal(src.indexOf(start,i+start.length),-1,'Duplicate playback route');
 return {head:src.slice(0,i),playback:src.slice(i,j+end.length),
         tail:src.slice(j+end.length)};
}
function fnv1a64(s){
 let hash=0xcbf29ce484222325n;
 for(const byte of Buffer.from(s,'utf8')){
   hash=(hash^BigInt(byte))*0x100000001b3n & 0xffffffffffffffffn;
 }
 return hash.toString(16).padStart(16,'0');
}
const parts=splitSections();
const canonical=parts.head+'__PLAYBACK_V30_HERE__'+parts.tail;
test('all NON-playback code byte-identical to deployed v22 contract fingerprint',()=>{
 assert.equal(fnv1a64(canonical),'e1be997fd22fe6c8',
   'Non-playback production behavior drifted; review diff before any release');
});
test('v22 credential rate limit and pairing PATCH stay inside the same 60s gate',()=>{
 const auth=parts.head.slice(parts.head.indexOf('async function authenticateDevice('));
 const gate=auth.indexOf("if (!Number.isFinite(lastUsedAtMs) || nowMs - lastUsedAtMs >= 60_000) {");
 const pairing=auth.indexOf(".from('device_pairing_requests')");
 const tail=auth.indexOf('return { ...device, offline_access_expires_at');
 assert.ok(gate>0 && pairing>gate && pairing<tail);
 assert.match(auth,/if \(pairingCleanupError\) console\.error\('pairing_token_cleanup_failed'/);
});
test('push keeps deployed v22 FCM unavailable fallback without token writes',()=>{
 const push=parts.head.slice(parts.head.indexOf("if (action === 'register_push')"),
   parts.head.indexOf("if (action === 'player_settings')"));
 assert.match(push,/push_enabled:false/);
 assert.match(push,/fcm_unavailable/);
 assert.doesNotMatch(push,/device_push_tokens|\.upsert\(/);
});
test('heartbeat, commands, playlist manifest, screenshots and pairing preserve v22 handlers',()=>{
 const merged=parts.head+parts.tail;
 for(const name of ['heartbeat','commands','command_result','manifest',
                    'player_settings','unpair','screenshot_result']){
   assert.ok(merged.includes("if (action === '"+name+"')"),
      'Missing deployed v22 action '+name);
 }
 assert.ok(parts.head.includes("if (action === 'register_push')"));
});
test('only playback_batch rejects invalid batch and still ACKs duplicate identities',()=>{
 const p=parts.playback;
 assert.match(p,/clientEventId\.length > 120/);
 assert.match(p,/return json\(\{ error: 'invalid_playback_event' \}, 400\)/);
 assert.match(p,/parsedEvents\.length !== events\.length/);
 assert.match(p,/ignoreDuplicates: true/);
 assert.match(p,/accepted: rows\.length/);
});
