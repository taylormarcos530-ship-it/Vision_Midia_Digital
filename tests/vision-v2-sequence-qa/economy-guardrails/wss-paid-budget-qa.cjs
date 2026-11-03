'use strict';
// Synthetic budget QA ONLY; official quotas must be verified before purchasing.
// Gateway CPU, Redis, TLS, commercial storage, network egress not priced here.
const assert=require('node:assert/strict');
const {plan}=require('./scalable-capacity-policy.cjs');
const DAYS=30,HOUR=3600,SEC=15,HB=90,ARCHIVE_BYTES_PER_EVENT=64.247;
const PRO={realtimeIncluded:5_000_000,realtimePkgUSD:2.5,
 edgeIncluded:2_000_000,edgePkgUSD:2.0,realtimePeakIncluded:500,
 storageGBIncluded:100};
const FREE={realtimeIncluded:2_000_000,realtimePeakIncluded:200,
 edgeIncluded:500_000,storageGBIncluded:1};
function compute(tvs,{hours=24,interval=HB,protocol='vision.presence.v1'}={}){
 if(!Number.isSafeInteger(tvs)||tvs<=0||hours<=0||hours>24)throw Error('invalid_budget_input');
 assert.equal(protocol,'vision.presence.v1');
 const seconds=DAYS*hours*HOUR;
 const heartbeats=tvs*Math.ceil(seconds/interval);
 const proofs=tvs*Math.ceil(seconds/SEC);
 const archiveUploadEdge=tvs*hours*DAYS; // hourly / TV, not all Edge usage
 const fileGB=proofs*ARCHIVE_BYTES_PER_EVENT/1e9;
 const realtimeSendsOnly=heartbeats; // lower-bound; subscribers/ack/broadcast ignored
 const rtOver=Math.max(0,realtimeSendsOnly-PRO.realtimeIncluded);
 const rtCostUSD=Math.ceil(rtOver/1e6)*PRO.realtimePkgUSD;
 const edgeOver=Math.max(0,archiveUploadEdge-PRO.edgeIncluded);
 const edgeCostUSD=Math.ceil(edgeOver/1e6)*PRO.edgePkgUSD;
 const capacity=plan({tvs,tier:'pro',presenceTransport:'gateway',onlineHours:hours});
 const row={tvs,hours,wireProtocol:protocol,heartbeats,proofs,
  archiveUploadEdgeCalls:archiveUploadEdge,
  minimumRealtimeMessagesIfSupabaseUsed:realtimeSendsOnly,
  hypotheticalSupabaseRealtimeMessagesExceedIncluded:realtimeSendsOnly>PRO.realtimeIncluded,
  hypotheticalSupabaseRealtimeOverageUSD:rtCostUSD,
  hypotheticalEdgeArchiveOverageUSD:edgeCostUSD,
  encryptedProofFilesGBLinearEstimate:+fileGB.toFixed(4),
  forecastWithinProStorageIncludedIfNoOtherStorage:fileGB<=PRO.storageGBIncluded,
  gatewayMinShardsWithHeadroom:capacity.capacity.requiredGatewayShards,
  proRealtimePeakIncludedWouldFit:tvs<=PRO.realtimePeakIncluded,
  freeRealtimePeakIncludedWouldFit:tvs<=FREE.realtimePeakIncluded,
  gatewayHostedElsewhere:true,gatewayHostingUSD:null,
  redisBackplaneUSD:null,mediaAndCacheEgressUSD:null,extraSQLUSD:null,
  billingApproved:false,securityApproved:false,production:'NO_GO'};
 return row;
}
const results=[100,300,600,1000,3000].map(tvs=>compute(tvs));
for(const r of results){
 assert.equal(r.archiveUploadEdgeCalls,r.tvs*720);
 assert(r.gatewayMinShardsWithHeadroom>=Math.ceil(r.tvs/175));
 assert(r.heartbeats>0 && r.proofs>0);
 assert(r.billingApproved===false && r.securityApproved===false);
 assert.equal(r.wireProtocol,'vision.presence.v1');
 if(r.tvs===300){
  assert.equal(r.heartbeats,8640000);assert.equal(r.archiveUploadEdgeCalls,216000);
  assert.equal(r.hypotheticalSupabaseRealtimeOverageUSD,10);
 }
 if(r.tvs===600){assert.equal(r.heartbeats,17280000);assert.equal(r.hypotheticalSupabaseRealtimeOverageUSD,32.5)}
 if(r.tvs===1000){assert.equal(r.heartbeats,28800000);assert.equal(r.hypotheticalSupabaseRealtimeOverageUSD,60)}
}
for(const tvs of [100,300,600,1000]){
 const a=compute(tvs,{hours:8}),b=compute(tvs,{hours:12}),
       c=compute(tvs,{hours:18}),d=compute(tvs,{hours:24});
 assert(a.heartbeats<b.heartbeats&&b.heartbeats<c.heartbeats&&c.heartbeats<d.heartbeats);
 assert(a.encryptedProofFilesGBLinearEstimate<=d.encryptedProofFilesGBLinearEstimate);
}
console.log('QA_PAID_WSS_BUDGET_JSON='+JSON.stringify({results,baseline:'hypothetical provider pricing',
 source:'public Supabase docs as of 2026-11-02',pro:PRO,free:FREE,
 caveat:'not real invoice: TLS/Redis/hosting, app downloads, object store, egress, support all excluded'}));
console.log('QA_PAID_WSS_BUDGET_PASS=true');
