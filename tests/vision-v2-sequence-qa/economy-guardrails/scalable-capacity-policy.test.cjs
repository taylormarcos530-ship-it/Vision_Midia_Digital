'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PROTOCOL,TIERS,plan,rendezvous,CapacityGate}=require('./scalable-capacity-policy.cjs');
test('plan quotas are explicit and never interpreted as universal plan capacity',()=>{
 assert.equal(TIERS.free.peakConnections,200);
 assert.equal(TIERS.pro.peakConnections,500);
 assert.equal(TIERS['pro-no-cap'].peakConnections,10000);
 assert.equal(TIERS.pro.realtimeMessages,5_000_000);
});
for(let tvs of [10,100,300,600,1000]){
 test(tvs+' TVs capacity scales by count rather than APK change',()=>{
  const a=plan({tvs,tier:'pro',presenceTransport:'gateway'});
  assert.equal(a.protocol,PROTOCOL);
  assert.equal(a.capacity.requiredGatewayShards,Math.ceil(tvs/175));
  assert.equal(a.usage.gatewayEdgeHeartbeatCalls,0);
  assert.equal(a.technicalAdmit,true);
  assert.equal(a.productionDecision.startsWith('NO_GO'),true);
  assert.equal(a.capacity.averageConnectionsPerGateway<=175,true);
 });
}
test('Free direct realtime rejects 300 peak devices before messaging',()=>{
 const p=plan({tvs:300,tier:'free',presenceTransport:'supabase-realtime'});
 assert.equal(p.budget.realtimeConnectionsFit,false);
 assert.equal(p.technicalAdmit,false);
});
test('Pro direct Realtime 300 connections fit 80% connection reserve but messages exceed 5m',()=>{
 const p=plan({tvs:300,tier:'pro',presenceTransport:'supabase-realtime',realtimeRecipients:1});
 assert.equal(p.budget.realtimeConnectionsFit,true);
 assert(p.usage.estimatedRealtimeBillableMessages>5_000_000);
 assert.equal(p.budget.exceedsRealtimeIncluded,true);
});
test('Pro no cap permits 600 direct realtime connections within 80% max, cost not free',()=>{
 const p=plan({tvs:600,tier:'pro-no-cap',presenceTransport:'supabase-realtime'});
 assert.equal(p.budget.realtimeConnectionsFit,true);
 assert.equal(p.budget.exceedsRealtimeIncluded,true);
});
test('Pro 600 direct realtime connections fail 80% reserved cap',()=>{
 const p=plan({tvs:600,tier:'pro',presenceTransport:'supabase-realtime'});
 assert.equal(p.budget.realtimeConnectionsFit,false);
});
test('same client wire version across Free to paid migration',()=>{
 const x=plan({tvs:100,tier:'free'});
 const y=plan({tvs:100,tier:'pro-no-cap'});
 assert.equal(x.protocol,y.protocol);
 assert.equal(x.usage.heartbeatMessages,y.usage.heartbeatMessages);
 assert.equal(x.usage.gatewayEdgeHeartbeatCalls,y.usage.gatewayEdgeHeartbeatCalls);
});
test('hourly upload Edge stays separate from real-time transport',()=>{
 const p=plan({tvs:300,tier:'pro',presenceTransport:'gateway',uploadIntervalMinutes:60});
 assert.equal(p.usage.estimatedEdgeInvocations,216000);
 assert.equal(p.usage.heartbeatMessages,8_640_000);
 assert.equal(p.usage.gatewayEdgeHeartbeatCalls,0);
 assert.equal(p.budget.exceedsEdgeIncluded,false);
});
test('other organization Edge traffic affects budget and cannot disappear',()=>{
 const a=plan({tvs:300,tier:'free',otherEdgeInvocations:300000});
 assert.equal(a.budget.exceedsEdgeIncluded,true);
});
test('multi-client shard routing deterministic for unchanged shard count',()=>{
 for(let n of [1,2,3,4,6]){
  const a=Array.from({length:600},(_,i)=>rendezvous('tv-'+i,n));
  const b=Array.from({length:600},(_,i)=>rendezvous('tv-'+i,n));
  assert.deepEqual(a,b);assert(a.every(x=>x>=0&&x<n));
 }
});
test('not silently admitting free 300 direct Realtime through different profile',()=>{
 const bad=plan({tvs:300,tier:'free',presenceTransport:'supabase-realtime'});
 const ok=plan({tvs:300,tier:'pro',presenceTransport:'gateway'});
 assert.equal(bad.technicalAdmit,false);assert.equal(ok.technicalAdmit,true);
 assert.equal(ok.operationsApproved,false);
});
test('rejected malformed cost policy parameters',()=>{
 for(const v of [-1,0,1.5,NaN])assert.throws(()=>plan({tvs:v}),/invalid_tvs/);
 assert.throws(()=>plan({tvs:10,tier:'future'}),/unknown_tier/);
 assert.throws(()=>plan({tvs:10,presenceTransport:'none'}),/unknown_transport/);
});
test('runtime plan upgrade alone never overrides security NO-GO flag',()=>{
 for(let tier of Object.keys(TIERS)){
  const p=plan({tvs:300,tier,externalGatewayBudgetApproved:true});
  assert(p.productionDecision.includes('NO_GO'));
 }
});

test('hard gate prevents skew: 10,100,300,600,1000,3000 devices no shard above 250',()=>{
 for(const tvs of [10,100,300,600,1000,3000]){
  const layout=plan({tvs,tier:'pro-no-cap',shardCapacity:250});
  const gate=new CapacityGate(layout.capacity.requiredGatewayShards,250);
  const leases=[];
  for(let i=0;i<tvs;i++){
   const d='tv-'+i;const admit=gate.admit(d);
   assert.equal(admit.ok,true,JSON.stringify({tvs,d,admit}));
   leases.push([d,admit.lease]);
  }
  const snap=gate.snapshot();
  assert.equal(snap.active,tvs);
  assert(snap.highWater<=250,JSON.stringify({tvs,snap}));
  // Repeated connect cannot double-count, even while changing paid capacity tier.
  assert.equal(gate.admit('tv-0').ok,false);
  assert.equal(gate.release('tv-0',leases[0][1]+1),false,'stale release incorrectly accepted');
  assert.equal(gate.snapshot().active,tvs);
  assert.equal(gate.release('tv-0',leases[0][1]),true);
  assert.equal(gate.snapshot().active,tvs-1);
 }
});
test('hard gate refuses real overflow rather than approving average utilization',()=>{
 const gate=new CapacityGate(2,2);
 for(let i=0;i<4;i++)assert.equal(gate.admit('tv-'+i).ok,true);
 assert.deepEqual(gate.admit('another'),{ok:false,reason:'CAPACITY_EXHAUSTED'});
 assert.equal(gate.snapshot().highWater,2);
});
test('capacity profile does not solve authenticated fencing or TOCTOU',()=>{
 const p=plan({tvs:300,tier:'pro-no-cap',externalGatewayBudgetApproved:true});
 assert.equal(p.capacity.requiresHardAdmissionGate,true);
 assert(p.productionDecision.includes('TOCTOU'));
});
