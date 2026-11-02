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
function rendezvous(device,shards){
 // Stable for same list; adding shards can remap devices, by design.
 let best=-1,bestScore=-1;
 for(let i=0;i<shards;i++){
  let h=2166136261;
  for(let c of device+'#'+i)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;
  if(h>bestScore){best=i;bestScore=h}
 }
 return best;
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
 const requiredShards=Math.ceil(tvs/shardCapacity);
 const gatewayByteEstimate=hb*100; // illustrative messages 100B; not network measurement
 const canUseRealtime=presenceTransport==='supabase-realtime' && tvs<=rtConnectionHeadroom;
 const exceedsRealtimeIncluded=rtMessages>limits.realtimeMessages;
 const exceedsEdgeIncluded=edgeCalls>limits.edgeInvocations;
 const technicalAdmit=presenceTransport==='gateway'?requiredShards>=1:canUseRealtime;
 const operationsApproved=presenceTransport==='gateway' && externalGatewayBudgetApproved;
 return {protocol:PROTOCOL,tier,tvs,presenceTransport,onlineHours,heartbeatSeconds,
  capacity:{maxPeakConnections:limits.peakConnections,safeRealtimeConnections:rtConnectionHeadroom,
   gatewayShardCapacity:shardCapacity,requiredGatewayShards:requiredShards,
   peakConnectionsPerGateway:Math.ceil(tvs/requiredShards),tenantCount},
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
module.exports={PROTOCOL,TIERS,plan,rendezvous};
