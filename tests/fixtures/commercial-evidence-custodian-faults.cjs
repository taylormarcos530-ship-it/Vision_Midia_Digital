// OFFLINE LAB ONLY: simulated anchor custodian, outage, compare-and-swap and recovery.
// No true independent storage/authentication, disk or remote network. NO DEPLOY AUTHORITY.
// All identities, request IDs, receipts, and witness heads are synthetic.
'use strict';
const {verifyChain}=require('./commercial-evidence-hash-chain.cjs');
const {verifyLabAnchors,ZERO}=require('./commercial-evidence-external-anchor.cjs');

const HEAD=/^[a-f0-9]{64}$/;
const REQUEST=/^REQ-[A-Z0-9]{8}$/;
const equalKeys=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const copy=x=>structuredClone(x);
function createLabCustodian(chain){
 const result=verifyChain(chain);
 if(!result.chainConsistent||result.historyNeedsReview)
  throw new TypeError('Synthetic history must be valid before custody');
 const reference=copy(chain);
 const committed=[];
 const requests=new Map();
 let available=true;
 const history=[];
 const head=()=>committed.length?committed.at(-1).receiptHash:ZERO;
 const state=()=>Object.freeze({count:committed.length,head:head()});
 const pushAudit=(event,status)=>{
  // Deliberately exclude digests, reference IDs, roles, paths and credentials.
  history.push(Object.freeze({event,status,order:history.length+1}));
 };
 function access(role,need){
  return need==='read'?role==='REVIEWER'||role==='WRITER':
   need==='write'?role==='WRITER':role==='OPERATOR';
 }
 function availability({role,online}){
  if(!access(role,'operator')||typeof online!=='boolean')return {status:'DENIED'};
  available=online;
  pushAudit('availability',online?'ONLINE':'OFFLINE');
  return {status:online?'ONLINE':'OFFLINE'};
 }
 function read({role}){
  if(!access(role,'read'))return Object.freeze({status:'DENIED'});
  if(!available)return Object.freeze({status:'UNAVAILABLE'});
  return Object.freeze({status:'OK',...state()});
 }
 function publish(data){
  if(!equalKeys(data,['role','receipt','expectedHead','requestId']))
   throw new TypeError('Invalid publication request fields');
  if(!access(data.role,'write')){pushAudit('publish','DENIED');return {status:'DENIED'}}
  if(!HEAD.test(data.expectedHead)||!REQUEST.test(data.requestId))
   throw new TypeError('Invalid CAS head or opaque idempotency key');
  if(!equalKeys(data.receipt,['version','anchorNumber','recordCount','headHash',
   'previousAnchorHash','stampedAt','receiptHash']))
   throw new TypeError('Invalid receipt fields');
  if(!available){pushAudit('publish','UNAVAILABLE');return {status:'UNAVAILABLE'}}
  const prior=requests.get(data.requestId);
  if(prior){
   const match=prior.receiptHash===data.receipt.receiptHash&&
    prior.expectedHead===data.expectedHead;
   pushAudit('publish',match?'ALREADY_COMMITTED':'IDEMPOTENCY_CONFLICT');
   return {status:match?'ALREADY_COMMITTED':'IDEMPOTENCY_CONFLICT'};
  }
  if(head()!==data.expectedHead){
   pushAudit('publish','CONFLICT_STALE_HEAD');
   return {status:'CONFLICT_STALE_HEAD'};
  }
  // Validate against complete, real local synthetic history prefix. A published
  // receipt must advance the *current* ledger and cover strictly more records.
  let accepted=false;
  try{
   const n=data.receipt.recordCount;
   if(Number.isSafeInteger(n)&&n<=reference.length&&n>0&&
      (!committed.length||n>committed.at(-1).recordCount)&&
      data.receipt.anchorNumber===committed.length+1){
    const attempt=verifyLabAnchors(reference.slice(0,n),
     [...committed,data.receipt]);
    accepted=attempt.locallyConsistent;
   }
  }catch{}
  if(!accepted){pushAudit('publish','INVALID_RECEIPT');return {status:'INVALID_RECEIPT'}}
  committed.push(Object.freeze(copy(data.receipt)));
  requests.set(data.requestId,Object.freeze({
   receiptHash:data.receipt.receiptHash,expectedHead:data.expectedHead
  }));
  pushAudit('publish','COMMITTED');
  return Object.freeze({status:'COMMITTED',...state()});
 }
 function snapshot({role}){
  if(!access(role,'read'))return {status:'DENIED'};
  if(!available)return {status:'UNAVAILABLE'};
  return {status:'OK',snapshot:{
   receipts:copy(committed),
   count:committed.length,
   head:head()
  }};
 }
 function inspectBackup({role,backup,independentlyHeldDigest}){
  if(!access(role,'read'))return {status:'DENIED'};
  if(!available)return {status:'UNAVAILABLE'};
  if(!HEAD.test(independentlyHeldDigest))return {status:'INVALID_REFERENCE'};
  if(!equalKeys(backup,['receipts','count','head'])||
    !Array.isArray(backup.receipts)||!Number.isSafeInteger(backup.count)||
    !HEAD.test(backup.head)||backup.count!==backup.receipts.length)
   return {status:'INVALID_BACKUP'};
  if(!backup.count)return {status:'STALE_BACKUP_REJECTED'};
  let valid;
  try{
   const n=backup.receipts.at(-1).recordCount;
   valid=Number.isSafeInteger(n)&&n>0&&n<=reference.length&&
    verifyLabAnchors(reference.slice(0,n),backup.receipts).locallyConsistent&&
    backup.head===backup.receipts.at(-1).receiptHash;
  }catch{valid=false}
  if(!valid)return {status:'CORRUPTED_BACKUP_REJECTED'};
  if(backup.head!==independentlyHeldDigest)
   return {status:'INDEPENDENT_HEAD_MISMATCH'};
  if(backup.head!==head()||backup.count!==committed.length)
   return {status:'LIVE_CUSTODIAN_DIVERGENCE'};
  // No mutate, no automated restore; even a matching backup is merely a review candidate.
  return {status:'MANUAL_REVIEW_ONLY',canRestoreAutomatically:false,
   externalCustodyVerified:false};
 }
 function audit({role}){
  if(!access(role,'read'))return {status:'DENIED'};
  if(!available)return {status:'UNAVAILABLE'};
  return {status:'OK',events:copy(history)};
 }
 return Object.freeze({
  availability,read,publish,snapshot,inspectBackup,audit,
  canConnectStaging:false,canDeployToProduction:false
 });
}
module.exports={createLabCustodian};
