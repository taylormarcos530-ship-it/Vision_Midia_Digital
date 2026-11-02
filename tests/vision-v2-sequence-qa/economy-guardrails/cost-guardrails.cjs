'use strict';
// Synthetic-only cost safety model for Vision V2. NO external API.
// Monthly units are decimal GB; runtime integer counters, not live billing.
// Capacities are documented as input assumptions and deliberately conservative.
const SECOND=1000,DAY=86400,MONTH_DAYS=30,DECIMAL_GB=1_000_000_000;
const FREE=Object.freeze({edge:500_000,egress:5*DECIMAL_GB,db:500_000_000,storage:1*DECIMAL_GB});
const SAFE=Object.freeze({edge:350_000,egress:3_500_000_000,db:350_000_000,storage:700_000_000});
const PROOF_BATCH_MAX=50; // Existing isolated Edge QA API contract, NOT an adjustable assumption.
const REPORT_GZIP_BYTES=437_137; // Historical synthetic commercial fixture; not actual customer usage.
function integer(n,description){if(!Number.isSafeInteger(n)||n<0)throw Error('invalid_'+description);return n}
function ceilDiv(n,d){return Math.ceil(n/d)}
function monthly({tvs,onlineHours=24,proofEverySeconds=15,cycleEveryMinutes=2,
 batch=PROOF_BATCH_MAX,separateProofs=false,
 proofRowBytes=160,reportBytes=REPORT_GZIP_BYTES,
 reportDownloadsPerTvPerDay=1,mediaMbPerTv=0,mediaRefreshes=0,
 otherOrganizationEdge=0,otherOrganizationEgressBytes=0,
 previousDbBytes=0,otherStorageBytes=0}){
 for(const [key,val] of Object.entries({tvs,onlineHours,proofEverySeconds,cycleEveryMinutes,batch,
  proofRowBytes,reportBytes,reportDownloadsPerTvPerDay,mediaMbPerTv,
  mediaRefreshes,otherOrganizationEdge,otherOrganizationEgressBytes,previousDbBytes,otherStorageBytes}))
  {if(!Number.isFinite(val)||val<0)throw Error('invalid_'+key)}
 if(tvs<1||onlineHours>24||proofEverySeconds<1||cycleEveryMinutes<=0||batch<1||batch>PROOF_BATCH_MAX)
  throw Error('unsafe_model_arguments');
 const perTvProofs=Math.ceil(MONTH_DAYS*onlineHours*3600/proofEverySeconds);
 const proofs=tvs*perTvProofs;
 const perTvCycles=Math.ceil(MONTH_DAYS*onlineHours*60/cycleEveryMinutes);
 const cycles=tvs*perTvCycles;
 const proofRequests=tvs*ceilDiv(perTvProofs,batch);
 // If each cycle includes at most 50 proofs, total calls are bounded below
 // by MAX(cycles, batches). If proof uploads are independent then SUM.
 const edgePlayer=separateProofs?cycles+proofRequests:Math.max(cycles,proofRequests);
 const edge=edgePlayer+otherOrganizationEdge;
 const reports=tvs*MONTH_DAYS*reportDownloadsPerTvPerDay*reportBytes;
 const media=tvs*mediaMbPerTv*1_000_000*mediaRefreshes;
 const egress=reports+media+otherOrganizationEgressBytes;
 const dbProofs=proofs*proofRowBytes, db=previousDbBytes+dbProofs;
 const measures={tvs,monthlyProofs:proofs,monthlyCycles:cycles,monthlyProofBatchCalls:proofRequests,
  monthlyEdgeCallsLowerBound:edge, monthlyReportBytes:reports,monthlyMediaBytes:media,
  monthlyEgressBytes:egress,monthProofRowsEstimatedDbBytes:dbProofs,dbTotalEstimatedBytes:db,
  storageExternalAlreadyUsed:otherStorageBytes,
  invalidationNote:'not modeled: realtime, request headers, auth, response logs, WAL, indexes, retained history, archive, retries'};
 const measured={edge,egress,db,storage:otherStorageBytes};
 const check=Object.fromEntries(Object.keys(SAFE).map(k=>[k,{value:measured[k],
  target:SAFE[k],free:FREE[k],withinReserve:measured[k]<=SAFE[k],
  exceedsFree:measured[k]>FREE[k]}]));
 return {measurements:measures,checks:check,approval:Object.values(check).every(x=>x.withinReserve)?'PASS_MODEL_ONLY':'NO_GO_BUDGET'};
}
function spendAllowance({currentEdgeCalls=0,currentEgressBytes=0,edgePlanned=0,egressPlanned=0}){
 const vals=[currentEdgeCalls,currentEgressBytes,edgePlanned,egressPlanned];
 if(vals.some(x=>!Number.isSafeInteger(x)||x<0))throw Error('invalid_allowance');
 const edgeLeft=Math.max(0,SAFE.edge-currentEdgeCalls);
 const egressLeft=Math.max(0,SAFE.egress-currentEgressBytes);
 return {edgeLeft,egressLeft,mayAdmit:edgePlanned<=edgeLeft&&egressPlanned<=egressLeft};
}
function stringHash(s){
 let n=2166136261;
 for(const c of s){n=Math.imul(n^c.charCodeAt(0),16777619)>>>0}
 return n;
}
class LocalProofQueue {
 constructor(deviceId){
  this.deviceId=deviceId;
  this.pending=[];this.next=1;this.ack=0;
  this.blockedUntil=0;this.blockedLevel=0;this.invalidCredentials=false;
  this.attempts=0;this.sent=0;
 }
 add(proof){const seq=this.next++;this.pending.push({seq,proof});return seq}
 request(now){
  if(this.invalidCredentials||now<this.blockedUntil||!this.pending.length)return null;
  const batch=this.pending.slice(0,PROOF_BATCH_MAX);
  this.attempts++;this.sent+=batch.length;
  return {deviceId:this.deviceId,from:batch[0].seq,to:batch.at(-1).seq,
    stream:'synthetic-only',events:batch};
 }
 response(now,req,status,reply={}){
  if(!req)return {action:'SKIP'};
  if(status===402){
   this.blockedLevel=Math.min(this.blockedLevel+1,3);
   const pause=Math.min(86400,21600*2**(this.blockedLevel-1));
   const jitter=stringHash(this.deviceId)%3600; // stable per TV, avoids synchronized retry storms.
   this.blockedUntil=now+pause*SECOND+jitter*SECOND;
   return {action:'QUOTA_RESTRICTION',blockedMs:this.blockedUntil-now,ack:this.ack};
  }
  if(status===401||status===403){
   this.invalidCredentials=true;
   return {action:'AUTH_DENIED_NO_RETRY',ack:this.ack};
  }
  if(status===429||status>=500){
   const jitter=stringHash(this.deviceId)%300;
   this.blockedUntil=now+(status===429?300+jitter:60+jitter)*SECOND;
   return {action:'TEMPORARY_BACKOFF',ack:this.ack};
  }
  if(status!==200 || !reply || reply.complete!==true || reply.stream!==req.stream ||
      !Number.isSafeInteger(reply.ack)||reply.ack<req.from-1||reply.ack>req.to ||
      reply.ack<this.ack){
   this.blockedUntil=now+60*SECOND;
   return {action:'INVALID_ACK_PRESERVE_QUEUE',ack:this.ack};
  }
  this.ack=reply.ack;
  this.pending=this.pending.filter(e=>e.seq>this.ack);
  this.blockedLevel=0;this.blockedUntil=0;
  return {action:'ACK_DURABLE',ack:this.ack,pending:this.pending.length};
 }
 state(){return {deviceId:this.deviceId,pending:this.pending.length,
  ack:this.ack,blockedUntil:this.blockedUntil,blockedLevel:this.blockedLevel,
  attempts:this.attempts,proofsSent:this.sent}};
}
module.exports={FREE,SAFE,MONTH_DAYS,PROOF_BATCH_MAX,REPORT_GZIP_BYTES,monthly,spendAllowance,LocalProofQueue};
