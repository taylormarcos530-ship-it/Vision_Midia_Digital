'use strict';
// QA-only capacity policy. Does NOT change backend plan, payment, TV APK, or deployed config.
// Published Supabase quotas as of Nov 2026; always reverify before rollout.
// Stable wire protocol is an architectural contract, NOT proof the current APK uses it.
const PROTOCOL='vision.presence.v1';
const TIERS=Object.freeze({
 free:Object.freeze({peakConnections:200,realtimeMessages:2_000_000,edgeInvocations:500_000}),
 pro:Object.freeze({peakConnections:500,realtimeMessages:5_000_000,edgeInvocations:2_000_000}),
 'pro-no-cap':Object.freeze({peakConnections:10_000,realtimeMessages:5_000_000,edgeInvocations:2_000_000})
});
function safe(n,name){if(!Number.isSafeInteger(n)||n<=0)throw Error('invalid_'+name);return n}
const crypto=require('node:crypto');
function rankedShards(device,shards){
 const scores=Array.from({length:shards},(_,i)=>({
  shard:i,score:crypto.createHash('sha256').update(device+'#'+i).digest('hex')
 }));
 scores.sort((a,b)=>b.score.localeCompare(a.score));
 return scores.map(x=>x.shard);
}
function rendezvous(device,shards){return rankedShards(device,shards)[0]}
class CapacityGate{
 constructor(shards,hardCap=250){
  safe(shards,'shards');safe(hardCap,'hardCap');
  this.shards=shards;this.hardCap=hardCap;
  this.counts=Array(shards).fill(0);
  this.leases=new Map();this.nextLease=0;
 }
 admit(device){
  if(typeof device!=='string'||!device)throw Error('invalid_device');
  if(this.leases.has(device))return {ok:false,reason:'ALREADY_CONNECTED'};
  const shard=rankedShards(device,this.shards).find(i=>this.counts[i]<this.hardCap);
  if(shard===undefined)return {ok:false,reason:'CAPACITY_EXHAUSTED'};
  const lease=++this.nextLease;
  this.leases.set(device,{shard,lease});this.counts[shard]++;
  return {ok:true,shard,lease};
 }
 release(device,lease){
  const active=this.leases.get(device);
  if(!active||active.lease!==lease)return false;
  this.counts[active.shard]--;this.leases.delete(device);return true;
 }
 snapshot(){return {shards:this.shards,hardCap:this.hardCap,counts:[...this.counts],
    active:this.leases.size,highWater:Math.max(...this.counts)}}
}
function plan({tvs,tier='free',heartbeatSeconds=90,onlineHours=24,
 presenceTransport='gateway',shardCapacity=250,tenantCount=1,
 reservedConnectionFraction=0.2,realtimeRecipients=1,
 uploadIntervalMinutes=60,otherEdgeInvocations=0,
 externalGatewayBudgetApproved=false}){
 safe(tvs,'tvs');safe(heartbeatSeconds,'heartbeatSeconds');safe(shardCapacity,'shardCapacity');
 safe(tenantCount,'tenantCount');safe(realtimeRecipients,'realtimeRecipients');
 safe(uploadIntervalMinutes,'uploadIntervalMinutes');
 if(!(tier in TIERS))throw Error('unknown_tier');
 if(!['gateway','supabase-realtime'].includes(presenceTransport))throw Error('unknown_transport');
 if(!Number.isInteger(onlineHours)||onlineHours<1||onlineHours>24)throw Error('onlineHours');
 if(!Number.isFinite(reservedConnectionFraction)||reservedConnectionFraction<0||reservedConnectionFraction>=1)throw Error('reserve');
 if(!Number.isSafeInteger(otherEdgeInvocations)||otherEdgeInvocations<0)throw Error('otherEdgeInvocations');
 const limits=TIERS[tier],seconds=30*onlineHours*3600;
 const hb=Math.ceil(seconds/heartbeatSeconds)*tvs;
 const uploadCalls=tvs*Math.ceil(seconds/(uploadIntervalMinutes*60));
 const edgeCalls=uploadCalls+otherEdgeInvocations;
 const rtMessages=presenceTransport==='supabase-realtime'?hb*(1+realtimeRecipients):0;
 // Supabase Realtime broadcast counts outgoing plus recipients. Presence can differ.
 const rtConnectionHeadroom=Math.floor(limits.peakConnections*(1-reservedConnectionFraction));
 // 70% occupancy target to absorb shard skew, reconnections and temporary imbalance.
 const shardTarget=Math.max(1,Math.floor(shardCapacity*0.7));
 const requiredShards=Math.ceil(tvs/shardTarget);
 const gatewayByteEstimate=hb*100; // illustrative messages 100B; not network measurement
 const canUseRealtime=presenceTransport==='supabase-realtime' && tvs<=rtConnectionHeadroom;
 const exceedsRealtimeIncluded=rtMessages>limits.realtimeMessages;
 const exceedsEdgeIncluded=edgeCalls>limits.edgeInvocations;
 const technicalAdmit=presenceTransport==='gateway'?requiredShards>=1:canUseRealtime;
 const operationsApproved=presenceTransport==='gateway' && externalGatewayBudgetApproved;
 return {protocol:PROTOCOL,tier,tvs,presenceTransport,onlineHours,heartbeatSeconds,
  capacity:{maxPeakConnections:limits.peakConnections,safeRealtimeConnections:rtConnectionHeadroom,
   gatewayShardCapacity:shardCapacity,gatewayShardTarget:shardTarget,requiredGatewayShards:requiredShards,
   averageConnectionsPerGateway:Math.ceil(tvs/requiredShards),requiresHardAdmissionGate:true,tenantCount},
  usage:{heartbeatMessages:hb,estimatedRealtimeBillableMessages:rtMessages,
   estimatedEdgeInvocations:edgeCalls,estimatedGatewayWireBytes:gatewayByteEstimate,
   gatewayEdgeHeartbeatCalls:0},
  budget:{includedRealtimeMessages:limits.realtimeMessages,includedEdgeInvocations:limits.edgeInvocations,
   exceedsRealtimeIncluded,exceedsEdgeIncluded,
   realtimeConnectionsFit:canUseRealtime},
  technicalAdmit,operationsApproved,
  productionDecision:'NO_GO_UNTIL_HOSTING_AUTH_BACKPLANE_TOCTOU_VALIDATED',
  notes:['Client protocol remains same across plan variants only after APK/client integration',
   'Gateway is a separately hosted service and has real server/network/ops cost',
   'Realtime message billing depends on recipients and actual provider protocol',
   'No proven 90s multi-host failover or server-side auth integration']};
}
module.exports={PROTOCOL,TIERS,plan,rendezvous,rankedShards,CapacityGate};
