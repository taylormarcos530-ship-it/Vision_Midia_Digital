'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {FREE,SAFE,monthly,spendAllowance,LocalProofQueue,PROOF_BATCH_MAX}=require('./cost-guardrails.cjs');
const root=path.resolve(__dirname,'../../..');
function projection(tvs,opts={}){return monthly({tvs,...opts})}
test('Free snapshots are explicit, with organization reserve 30%',()=>{
 assert.equal(FREE.edge,500000);assert.equal(FREE.egress,5e9);
 assert.equal(FREE.db,500e6);assert.equal(FREE.storage,1e9);
 assert.equal(SAFE.edge,350000);assert.equal(SAFE.egress,3.5e9);
});
test('V2 isolated Edge code actually limits playback proof batch to 50',()=>{
 const source=fs.readFileSync(path.join(root,'supabase/functions/vision-v2-qa-device/index.ts'),'utf8');
 const bundle=fs.readFileSync(path.join(root,'supabase/functions/device-bundle-stable/index.ts'),'utf8');
 assert.match(source,/events\.length\s*>\s*50|events\.length\s*<=\s*50/);
 assert.match(bundle,/body\.proofs\.length\s*>\s*50/);
 assert.equal(PROOF_BATCH_MAX,50);
});
for(const tvs of [10,100,300]){
 test(tvs+' TVs: 15sec full proofs and 2min cycles => reserve guard refuses unsafe scenarios',()=>{
  const p=projection(tvs);
  assert.equal(p.measurements.monthlyProofs,tvs*172800);
  assert.equal(p.measurements.monthlyCycles,tvs*21600);
  assert.equal(p.measurements.monthlyProofBatchCalls,tvs*3456);
  assert.equal(p.measurements.monthlyEdgeCallsLowerBound,tvs*21600);
  assert.equal(p.checks.db.exceedsFree,tvs>=100);
  if(tvs>=100)assert.equal(p.approval,'NO_GO_BUDGET');
  if(tvs===10)assert.equal(p.approval,'PASS_MODEL_ONLY');
 });
}
test('300 TVs: even without ANY polling, proof Edge calls exceed Free and 30% reserve',()=>{
 const p=projection(300,{cycleEveryMinutes:10000});
 assert.equal(p.measurements.monthlyProofs,51840000);
 assert.equal(p.measurements.monthlyProofBatchCalls,1036800);
 assert.equal(p.measurements.monthlyEdgeCallsLowerBound,1036800);
 assert(p.measurements.monthProofRowsEstimatedDbBytes>6e9);
 assert(p.checks.edge.exceedsFree);
 assert(p.checks.db.exceedsFree);
 assert.equal(p.approval,'NO_GO_BUDGET');
});
test('100 TVs: proof uploads with separate Edge functions exceed reserve even at one cycle/day',()=>{
 const p=projection(100,{cycleEveryMinutes:1440,separateProofs:true});
 assert.equal(p.measurements.monthlyEdgeCallsLowerBound,348600);
 assert.equal(p.approval,'NO_GO_BUDGET'); // DB proof rows + other obligations.
});
test('reports and media can exceed egress even if Edge calls are reduced',()=>{
 const p=projection(300,{reportDownloadsPerTvPerDay:1,mediaMbPerTv:170,mediaRefreshes:1});
 assert.equal(p.measurements.monthlyMediaBytes,51000000000);
 assert.equal(p.measurements.monthlyReportBytes,3934233000);
 assert(p.checks.egress.exceedsFree);assert.equal(p.approval,'NO_GO_BUDGET');
 const reports=projection(300,{cycleEveryMinutes:10000});
 assert(reports.checks.egress.withinReserve===false); // reports alone ~3.93GB >3.5GB reserve.
});
test('one media 170MB per TV across 30 devices is 5.1GB even before reports',()=>{
 const r=projection(30,{mediaMbPerTv:170,mediaRefreshes:1,reportDownloadsPerTvPerDay:0});
 assert.equal(r.measurements.monthlyMediaBytes,5100000000);
 assert.equal(r.checks.egress.exceedsFree,true);
});
test('exact SAFE allowance refuses planned overage and never treats zero as infinite',()=>{
 assert.equal(spendAllowance({currentEdgeCalls:349999,edgePlanned:2}).mayAdmit,false);
 assert.equal(spendAllowance({currentEdgeCalls:349999,edgePlanned:1}).mayAdmit,true);
 assert.equal(spendAllowance({currentEdgeCalls:350000,edgePlanned:1}).mayAdmit,false);
 assert.equal(spendAllowance({currentEgressBytes:3499999999,egressPlanned:2}).mayAdmit,false);
});
test('HTTP 402 preserves 50 proofs with watermark unchanged and 6h+deterministic jitter',()=>{
 const q=new LocalProofQueue('tv-001');
 for(let i=0;i<50;i++)q.add({event:'qa',i});
 const req=q.request(1000000000);assert(req);assert.equal(req.events.length,50);
 const blocked=q.response(1000000000,req,402);
 assert.equal(blocked.action,'QUOTA_RESTRICTION');
 assert.equal(q.pending.length,50);assert.equal(q.ack,0);
 assert.equal(q.request(1000000000+10*1000),null);
 assert(q.blockedUntil>=1000000000+6*3600*1000);
 assert(q.blockedUntil<1000000000+7*3600*1000);
});
test('repeating HTTP 402 has exponential cooldown 6h/12h/24h, zero hot retry',()=>{
 const q=new LocalProofQueue('tv-xx');q.add({id:1});
 const pauses=[];
 for(let i=0;i<3;i++){
   const now=i===0?0:q.blockedUntil;
   const req=q.request(now);assert(req);
   const resp=q.response(now,req,402);assert.equal(resp.action,'QUOTA_RESTRICTION');
   pauses.push((q.blockedUntil-now)/1000);
   assert.equal(q.request(now+1),null);
 }
 assert(pauses[0]>=21600&&pauses[0]<25200);
 assert(pauses[1]>=43200&&pauses[1]<46800);
 assert(pauses[2]>=86400&&pauses[2]<90000);
 assert.equal(q.ack,0);
});
test('401/403 never consume proofs or try again with rejected token',()=>{
 for(let code of [401,403]){
  const q=new LocalProofQueue('tv-'+code);q.add({id:1});
  const r=q.request(100);assert.equal(q.response(100,r,code).action,'AUTH_DENIED_NO_RETRY');
  assert.equal(q.request(1e12),null);assert.equal(q.ack,0);assert.equal(q.pending.length,1);
 }
});
test('200 truncated or wrong stream/watermark never ACK or delete local proof',()=>{
 for(const reply of [{stream:'synthetic-only',complete:false,ack:3},
  {stream:'old-boot',complete:true,ack:3},{stream:'synthetic-only',complete:true,ack:900},
  {stream:'synthetic-only',complete:true,ack:NaN}]){
  const q=new LocalProofQueue('tv-a');for(let i=0;i<3;i++)q.add({i});
  const req=q.request(10);assert.equal(q.response(10,req,200,reply).action,'INVALID_ACK_PRESERVE_QUEUE');
  assert.equal(q.pending.length,3);assert.equal(q.ack,0);
 }
});
test('503 and 429 backoff queue persists; later correct ACK removes only committed prefix',()=>{
 const q=new LocalProofQueue('tv-b');
 for(let i=0;i<80;i++)q.add({i});
 let req=q.request(0);assert.equal(req.events.length,50);
 assert.equal(q.response(0,req,503).action,'TEMPORARY_BACKOFF');
 assert.equal(q.pending.length,80);
 req=q.request(q.blockedUntil);assert.equal(req.to,50);
 assert.equal(q.response(q.blockedUntil,req,200,{stream:req.stream,complete:true,ack:50}).action,'ACK_DURABLE');
 assert.equal(q.pending.length,30);assert.equal(q.ack,50);
 req=q.request(q.blockedUntil);assert.equal(req.from,51);
 assert.equal(q.response(100,req,200,{stream:req.stream,complete:true,ack:80}).action,'ACK_DURABLE');
 assert.equal(q.pending.length,0);
});
test('300 devices on HTTP402: one request per device, no burst in first 6h',()=>{
 const base=1e9,devices=Array.from({length:300},(_,i)=>new LocalProofQueue('tv-'+i));
 for(const q of devices){q.add({p:'qa'});const req=q.request(base);assert(req);q.response(base,req,402)}
 assert(devices.every(q=>q.request(base+5*3600*1000)===null));
 assert.equal(devices.reduce((s,q)=>s+q.attempts,0),300);
 const times=new Set(devices.map(q=>q.blockedUntil));
 assert(times.size>270,'jitter collisions indicate synchronized retry risk');
});
test('offline 7 days local queue retains all 40,320 proofs per device; no silent deletion',()=>{
 const q=new LocalProofQueue('tv-offline');
 for(let i=0;i<40320;i++)q.add({seq:i+1});
 assert.equal(q.pending.length,40320);assert.equal(q.next,40321);
 const req=q.request(0);assert.equal(req.to,50);
 q.response(0,req,402);
 assert.equal(q.pending.length,40320);assert.equal(q.ack,0);
 // Runtime memory test is only a JS queue, not Android SQLite durability.
});
test('model never equates playback event rows to 5GB egress or 500MB file Storage',()=>{
 const r=projection(300);assert(r.checks.db.exceedsFree);
 assert.equal(r.checks.storage.exceedsFree,false);
 assert.equal(r.checks.egress.exceedsFree,false); // 3.934 GB < 5 GB, but > safety margin.
 assert.equal(r.checks.egress.withinReserve,false);
});

test('300 TVs with only 12h/day still exceed Free proof-invocation cap at 50/batch',()=>{
 const a=projection(300,{onlineHours:12,cycleEveryMinutes:10000});
 assert.equal(a.measurements.monthlyProofs,25920000);
 assert.equal(a.measurements.monthlyProofBatchCalls,518400);
 assert.equal(a.checks.edge.exceedsFree,true);
 assert.equal(a.approval,'NO_GO_BUDGET');
});
test('300 TVs with 18h/day still need 777600 proof batches if using legacy 50 cap',()=>{
 const a=projection(300,{onlineHours:18,cycleEveryMinutes:10000});
 assert.equal(a.measurements.monthlyProofs,38880000);
 assert.equal(a.measurements.monthlyProofBatchCalls,777600);
 assert.equal(a.approval,'NO_GO_BUDGET');
});
test('Bundling one Edge HTTP cycle does not remove underlying old monitoring SQL writes',()=>{
 const source=fs.readFileSync(path.join(root,'supabase/functions/device-bundle-stable/index.ts'),'utf8');
 const start=source.indexOf('async function runExistingMonitoringAction(');
 const end=source.indexOf('\nasync function ',start+1);
 const segment=source.slice(start,end<0?undefined:end);
 assert.ok(start>=0);
 assert.match(segment,/\.from\('devices'\)\.update\(\{/);
 assert.match(segment,/last_seen_at:\s*now/);
 assert.match(segment,/\.from\('device_heartbeats'\)/);
 assert.match(source,/const lastOfflineSweepByCompany = new Map\(\)/);
});
test('Free reserve is NOT a promise even when only heartbeat is bundled',()=>{
 const a=projection(300,{onlineHours:8,cycleEveryMinutes:10000});
 assert.equal(a.measurements.monthlyProofBatchCalls,345600);
 // Only 4400 Edge invocations remain to our internal reserve before other actions.
 assert.equal(SAFE.edge-a.measurements.monthlyProofBatchCalls,4400);
 assert.equal(a.approval,'NO_GO_BUDGET'); // DB and reports still exceed reserve.
});

test('300 TVs: 90-second near-realtime Edge polling would consume 8.64M calls monthly',()=>{
 const p=projection(300,{cycleEveryMinutes:1.5,reportDownloadsPerTvPerDay:0});
 assert.equal(p.measurements.monthlyCycles,8640000);
 assert.equal(p.measurements.monthlyEdgeCallsLowerBound,8640000);
 assert.equal(p.approval,'NO_GO_BUDGET');
});
test('300 TVs: 30-minute Edge heartbeat still uses 432k calls, exceeds 350k reserve',()=>{
 const p=projection(300,{cycleEveryMinutes:30,reportDownloadsPerTvPerDay:0});
 assert.equal(p.measurements.monthlyCycles,432000);
 assert(p.checks.edge.withinReserve===false);
});
test('300 TVs: hourly encrypted archive upload alone =216k Edge calls, not proof of whole system',()=>{
 const tvs=300,hours=24,days=30;
 const hourlyArchiveCalls=tvs*hours*days;
 const marginRemaining=SAFE.edge-hourlyArchiveCalls;
 assert.equal(hourlyArchiveCalls,216000);
 assert.equal(marginRemaining,134000);
 const controlPollsEvery15Min=tvs*hours*days*4;
 assert.equal(controlPollsEvery15Min,864000);
 assert(hourlyArchiveCalls+controlPollsEvery15Min>FREE.edge);
});
test('300 TVs cannot have 90s guaranteed offline indicator from hourly polling alone',()=>{
 const requiredLastSeenSeconds=90;
 const hourlyCycleSeconds=3600;
 assert(hourlyCycleSeconds>requiredLastSeenSeconds);
 const pollsFor30Days=Math.ceil(300*30*86400/requiredLastSeenSeconds);
 assert.equal(pollsFor30Days,8640000);
 assert(pollsFor30Days>FREE.edge);
});
