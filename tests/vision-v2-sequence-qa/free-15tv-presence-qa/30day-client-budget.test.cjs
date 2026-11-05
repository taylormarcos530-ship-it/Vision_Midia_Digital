/** QA ONLY: 15 synthetic player state machines, accelerated 30-day model.
 Original APK/player code is not modified. Not a physical 30-day soak test.
 Signatures, JTI, WSS TLS and backend lifecycle belong to separate real CI.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const source=fs.readFileSync('player.js','utf8');
const patch=fs.readFileSync('docs/vision-v2/homolog-only-4minute-manifest-402-polling-20261104.patch','utf8');
for(const mark of [
 'manifest: 120_000,','QA_BUNDLE_MANIFEST_INTERVAL_MS = 120_000;',
 'heartbeat: 60_000,','commands: 45_000,','QA_BUNDLE_INTERVAL_MS = 58_000'
]) assert(source.includes(mark),'original contract changed: '+mark);
assert(patch.includes('+    manifest: 240_000,'));
assert(patch.includes('+  const QA_BUNDLE_MANIFEST_INTERVAL_MS = 240_000;'));
const DAY=24*60*60, DAYS=30,TVS=15,MINS=DAYS*24*60,FREE_EDGE=500000;
const hash=body=>crypto.createHash('sha256').update(body).digest('hex');
function validIntegrity(response){
 if(response.status!==200)return false;
 return Buffer.byteLength(response.body)===response.expectedBytes &&
  hash(response.body)===response.expectedSHA;
}
const original=JSON.stringify({device:'tv-01',lease:'valid',ads:['a','b'],epoch:42});
assert(validIntegrity({status:200,body:original,expectedBytes:Buffer.byteLength(original),expectedSHA:hash(original)}));
assert(!validIntegrity({status:200,body:original.slice(0,-5),expectedBytes:Buffer.byteLength(original),expectedSHA:hash(original)}));
let pending=[{event:'a'},{event:'b'},{event:'c'}];
function ackBatch(items,ack){
 if(!ack||ack.ok!==true||ack.accepted!==items.length)return items.slice();
 return [];
}
assert.equal(ackBatch(pending,{ok:true,accepted:2}).length,3,'partial ACK cleared commercial history');
assert.equal(ackBatch(pending,{ok:true,accepted:3}).length,0);
assert.equal(ackBatch(pending,{ok:false,accepted:3}).length,3);
const statuses=[];
function state(id){
 return {id,leaseMs:35*DAY*1000,nextManifestMs:(id+1)*3000,
  nextManifestAllowedMs:0,lastWssMs:-Infinity,
  queue:[],lastCommandAck:null,commercialUploads:0,manifestCalls:0,
  wssFrames:0,played:0,proofs:0,maxQueue:0,restrictions:0,
  cached:{hash:hash(original),expiresMs:35*DAY*1000},blocked:false};
}
const devices=Array.from({length:TVS},(_,i)=>state(i));
for(let minute=0;minute<MINS;minute++){
 const t=minute*60000;
 for(const d of devices){
  if(d.blocked||t>=d.leaseMs||t>=d.cached.expiresMs)continue;
  // Signed, independently fenced WSS presence is an EXTERNAL contractual
  // assumption, not proof from this model. No Edge invocation per heartbeat.
  assert(t-d.lastWssMs>=60000);
  d.lastWssMs=t;d.wssFrames++;
  d.played++;d.proofs++;
  d.queue.push({id:d.id+':'+minute});
  d.maxQueue=Math.max(d.maxQueue,d.queue.length);
  if(d.queue.length>=50){
   const submitted=d.queue.slice(0,50);
   const acknowledged=ackBatch(submitted,{ok:true,accepted:50});
   if(acknowledged.length!==0)throw Error('unexpected batch ACK failure');
   d.queue.splice(0,50);
   d.commercialUploads++;
  }
  if(t>=d.nextManifestMs&&t>=d.nextManifestAllowedMs){
   d.manifestCalls++;
   d.nextManifestMs+=4*60000;
  }
 }
}
// Verify backoff for a genuinely returning HTTP 402, no 58s retry storm.
const testDevice=state(100);
function handle402(d,now){
 d.restrictions++;
 d.nextManifestAllowedMs=now+30*60000+17000;
 // Keep already authorized cached content; do not bypass 403/local lease.
}
handle402(testDevice,0);
assert(testDevice.nextManifestAllowedMs>=30*60000);
assert(!testDevice.blocked,'HTTP402 must not become a 403 authorization grant or revocation');
assert(testDevice.cached.expiresMs>testDevice.nextManifestAllowedMs);
function enforce(d,now,serverStatus){
 if(serverStatus===403)d.blocked=true;
 return !d.blocked && now<d.leaseMs && now<d.cached.expiresMs;
}
assert(enforce(testDevice,4*60000,402),'cache playback should remain authorized during 402');
assert(!enforce(testDevice,4*60000,403),'403 must immediately stop playback');
const expires=state(101);expires.leaseMs=5000;
assert(enforce(expires,4000,null));
assert(!enforce(expires,5001,null),'offline local expiry bypass');
const commandState=devices[0];
const pendingCommand={id:'cmd123',device:commandState.id,epoch:42};
function commandAck(cmd,d){
 if(cmd.device!==d.id||cmd.epoch!==42||d.blocked)return false;
 if(d.lastCommandAck===cmd.id)return false;
 d.lastCommandAck=cmd.id;return true;
}
assert(commandAck(pendingCommand,commandState));
assert(!commandAck(pendingCommand,commandState),'duplicate command acknowledged twice');
assert(!commandAck({...pendingCommand,device:2},commandState),'wrong-device command accepted');
const sums=devices.reduce((a,d)=>{
 for(const key of ['played','proofs','wssFrames','manifestCalls','commercialUploads'])a[key]=(a[key]||0)+d[key];
 a.maxQueue=Math.max(a.maxQueue||0,d.maxQueue);return a;
},{});
const expected={wssFrames:648000,manifestCalls:162000,commercialUploads:12960,proofs:648000};
for(const [key,v] of Object.entries(expected))assert.equal(sums[key],v,key);
const callTotal=sums.manifestCalls+sums.commercialUploads;
assert.equal(callTotal,174960);assert(callTotal<FREE_EDGE);
const budget={
  Edge_manifest_4min:sums.manifestCalls,
  Edge_commercial_batch_50:sums.commercialUploads,
  Edge_total_if_ONLY_these_channels_use_Edge:callTotal,
  Edge_remaining_for_other_operations:FREE_EDGE-callTotal,
  old_58sec_Edge_bundle_IF_not_disabled:Math.ceil(TVS*DAYS*DAY/58),
  WSS_60sec_frames_not_Edge:sums.wssFrames,
  central_witness_SQL_reads_lower_bound_if_one_read_per_WSS_frame:sums.wssFrames,
  total_generated_proofs:sums.proofs,
  max_locally_queued_items:sums.maxQueue,
  other_retries_alerts_egress_db_storage_not_included:true,
  no_production_free_quota_guarantee:true,
};
assert(budget.old_58sec_Edge_bundle_IF_not_disabled>FREE_EDGE);
const result={
 QA:'PASS_LOCAL_ACCELERATED_30_DAY_MODEL_NO_DEPLOY',
 production_GO:false,
 actual_player_modified:false,
 real_TVS_connected_in_this_model:0,
 synthetic_TVS:TVS,
 days_accelerated:DAYS,
 no_58sec_Edge_bundle_required_in_candidate:true,
 heartbeat_WSS_every_seconds:60,
 manifest_cache_refresh_every_seconds:240,
 heartbeat_max_legacy_jitter_seconds:69,
 Master_offline_threshold_seconds:90,
 guarantee_under_real_multi_host_false:true,
 HTTP402_retry_cooldown_minutes:30,
 HTTP402_preserves_unexpired_cached_content:true,
 HTTP403_immediate_revoke:true,
 offline_expiry_fail_closed:true,
 commercial_batch_50_partial_ACK_retains_proofs:true,
 truncated_HTTP200_SHA_rejected:true,
 duplicate_and_cross_device_command_ACK_rejected:true,
 budget,
 security_verdict:'NO_GO_WSS_JTI_ROLLBACK_SPLIT_BRAIN_AND_LEGACY_BYPASS_REMAIN',
};
fs.writeFileSync('qa-v2-15tv-30day-client-model.json',JSON.stringify(result,null,2));
console.log('QA_15TV_30DAY_CLIENT_MODEL_JSON='+JSON.stringify(result));
