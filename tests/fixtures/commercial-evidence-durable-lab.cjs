// OFFLINE LAB ONLY — durable synthetic receipts under a controlled OS temp folder.
// No real independent custodian, database, credentials, staging, production or network.
// File integrity checksum is unkeyed: detects accidents, NOT malicious full rewrite.
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {verifyChain}=require('./commercial-evidence-hash-chain.cjs');
const {verifyLabAnchors,ZERO}=require('./commercial-evidence-external-anchor.cjs');

const HEAD=/^[0-9a-f]{64}$/;
const REQ=/^REQ-[A-Z0-9]{8}$/;
const MAX=128*1024;
const clone=x=>structuredClone(x);
const sha=x=>createHash('sha256').update('VISION-DURABLE-CUSTODY-LAB-V1\0')
 .update(JSON.stringify(x)).digest('hex');
const keys=(x,allowed)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===allowed.slice().sort().join('|');
function folderCheck(folder){
 if(typeof folder!=='string')throw new TypeError('Only synthetic temporary directories');
 const resolved=path.resolve(folder);
 if(path.dirname(resolved)!==path.resolve(os.tmpdir())||
  !/^vision-custody-durable-[A-Za-z0-9_-]+$/.test(path.basename(resolved)))
  throw new TypeError('Only synthetic temporary directories');
 const stat=fs.lstatSync(resolved);
 if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(resolved)!==resolved)
  throw new TypeError('Unsafe synthetic directory');
 return resolved;
}
function checksumState(value){
 return {...value,checksum:sha(value)};
}
function decodeState(data,chain){
 if(!keys(data,['version','receipts','requests','checksum'])||
    data.version!==1||!Array.isArray(data.receipts)||!Array.isArray(data.requests)||
    data.receipts.length>30||data.requests.length>60||!HEAD.test(data.checksum))
  throw new Error('PERSISTED_STATE_INVALID');
 const core={version:data.version,receipts:data.receipts,requests:data.requests};
 if(sha(core)!==data.checksum)throw new Error('PERSISTED_STATE_CHECKSUM_MISMATCH');
 if(data.receipts.length){
  const count=data.receipts.at(-1)?.recordCount;
  if(!Number.isSafeInteger(count)||count<1||count>chain.length||
   !verifyLabAnchors(chain.slice(0,count),data.receipts).locallyConsistent)
   throw new Error('PERSISTED_RECEIPT_CHAIN_INVALID');
 }
 const refs=new Map();
 for(const row of data.requests){
  if(!keys(row,['id','receiptHash','expectedHead'])||
     !REQ.test(row.id)||!HEAD.test(row.receiptHash)||!HEAD.test(row.expectedHead)||
     refs.has(row.id)||!data.receipts.some(r=>r.receiptHash===row.receiptHash))
   throw new Error('PERSISTED_IDEMPOTENCY_INVALID');
  refs.set(row.id,row);
 }
 if(refs.size!==data.receipts.length||
  data.receipts.some(r=>![...refs.values()].some(x=>x.receiptHash===r.receiptHash)))
  throw new Error('PERSISTED_IDEMPOTENCY_INCOMPLETE');
 return data;
}
function readState(dir,chain){
 const loc=path.join(dir,'ledger.json');
 let fd;
 try{
  const stat=fs.lstatSync(loc);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
   stat.size<=0||stat.size>MAX)throw new Error('PERSISTED_STATE_UNSAFE');
  fd=fs.openSync(loc,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const actual=fs.fstatSync(fd);
  if(actual.dev!==stat.dev||actual.ino!==stat.ino||actual.size!==stat.size)
   throw new Error('PERSISTED_STATE_UNSAFE');
  const bytes=fs.readFileSync(fd);
  if(bytes.length!==stat.size)throw new Error('PERSISTED_STATE_TRUNCATED');
  return decodeState(JSON.parse(bytes.toString('utf8')),chain);
 }catch(e){
  if(e.code==='ENOENT')return checksumState({version:1,receipts:[],requests:[]});
  throw e;
 }finally{if(fd!==undefined)fs.closeSync(fd)}
}
function createDurableLabCustodian(chain,{directory,expectedPinnedHead=null}={}){
 const h=verifyChain(chain);
 if(!h.chainConsistent||h.historyNeedsReview)
  throw new TypeError('Invalid synthetic historical chain');
 const dir=folderCheck(directory);
 const reference=clone(chain);
 if(expectedPinnedHead!==null&&!HEAD.test(expectedPinnedHead))
  throw new TypeError('Invalid external head format');
 const initial=readState(dir,reference);
 const head=x=>x.receipts.length?x.receipts.at(-1).receiptHash:ZERO;
 if(expectedPinnedHead!==null&&head(initial)!==expectedPinnedHead)
  throw new Error('EXTERNALLY_PINNED_HEAD_MISMATCH');
 const result=(status,state)=>({status,count:state.receipts.length,head:head(state)});
 function read(){
  const state=readState(dir,reference);
  return result('OK',state);
 }
 function publish({receipt,expectedHead,requestId,fault=null}={}){
  if(!HEAD.test(expectedHead)||!REQ.test(requestId)||
   !keys(receipt,['version','anchorNumber','recordCount','headHash',
    'previousAnchorHash','stampedAt','receiptHash']))
   throw new TypeError('Invalid synthetic write contract');
  if(![null,'BEFORE_TEMP_WRITE','AFTER_TEMP_SYNC','AFTER_RENAME_BEFORE_ACK'].includes(fault))
   throw new TypeError('Unsupported fault');
  // Advisory OS atomic mkdir lock serializes cooperating lab writers across processes.
  // A crash may leave the lock; do not silently break it.
  const lock=path.join(dir,'writer.lock');
  try{fs.mkdirSync(lock)}catch(e){if(e.code==='EEXIST')return {status:'LOCK_BUSY'};throw e}
  try{
   const state=readState(dir,reference);
   if(expectedPinnedHead!==null&&head(state)!==expectedPinnedHead)
    return {status:'EXTERNALLY_PINNED_HEAD_MISMATCH'};
   const prior=state.requests.find(x=>x.id===requestId);
   if(prior)return {status:prior.receiptHash===receipt.receiptHash&&
     prior.expectedHead===expectedHead?'ALREADY_COMMITTED':'IDEMPOTENCY_CONFLICT'};
   if(head(state)!==expectedHead)return {status:'CONFLICT_STALE_HEAD'};
   const n=receipt.recordCount;
   let valid=false;
   try{
    if(Number.isSafeInteger(n)&&n>0&&n<=reference.length&&
       (!state.receipts.length||n>state.receipts.at(-1).recordCount)&&
       receipt.anchorNumber===state.receipts.length+1)
     valid=verifyLabAnchors(reference.slice(0,n),
       [...state.receipts,receipt]).locallyConsistent;
   }catch{}
   if(!valid)return {status:'INVALID_RECEIPT'};
   const next=checksumState({version:1,
    receipts:[...state.receipts,clone(receipt)],
    requests:[...state.requests,{id:requestId,receiptHash:receipt.receiptHash,expectedHead}]});
   // The directory lock is already acquired; save within the same critical section.
   let pending;
   try{
    if(fault==='BEFORE_TEMP_WRITE')return {status:'SIMULATED_UNAVAILABLE'};
    pending=path.join(dir,'ledger-'+process.pid+'-'+Date.now()+'.tmp');
    const buf=Buffer.from(JSON.stringify(next)+'\n');
    if(buf.length>MAX)throw Error('PERSISTED_STATE_TOO_LARGE');
    const fd=fs.openSync(pending,fs.constants.O_WRONLY|fs.constants.O_CREAT|
     fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try{fs.writeFileSync(fd,buf);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    if(fault==='AFTER_TEMP_SYNC')return {status:'SIMULATED_UNAVAILABLE'};
    fs.renameSync(pending,path.join(dir,'ledger.json'));
    pending=null;
    const df=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
    try{fs.fsyncSync(df)}finally{fs.closeSync(df)}
    if(fault==='AFTER_RENAME_BEFORE_ACK')return {status:'ACK_LOST_AFTER_COMMIT'};
    return result('COMMITTED',next);
   }finally{if(pending){try{fs.unlinkSync(pending)}catch{}}}
  }finally{fs.rmdirSync(lock)}
 }
 return Object.freeze({read,publish,canRunRealStaging:false,
  canConnectStaging:false,canDeployToProduction:false});
}
module.exports={createDurableLabCustodian};
