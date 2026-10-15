// OFFLINE LAB ONLY. Manual-review simulation for orphaned synthetic writer.lock.
// NO automatic unlock, live-service credentials, staging, customer files, or deploy.
// Owner metadata and reviewer booleans are NOT authenticated. Never reuse in production.
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {createDurableLabCustodian}=require('./commercial-evidence-durable-lab.cjs');

const HEX=/^[a-f0-9]{64}$/;
const NONCE=/^[a-f0-9]{32}$/;
const TICKET=/^LAB-TICKET-[0-9]{6}$/;
const MAX_MARKER=1024;
const fingerprint=x=>createHash('sha256')
 .update('VISION-ORPHAN-LOCK-MARKER-V1\0')
 .update(JSON.stringify([x.version,x.pid,x.createdAt,x.nonce]))
 .digest('hex');

function controlledDir(folder){
 if(typeof folder!=='string')throw new TypeError('Only synthetic test folder allowed');
 const root=path.resolve(folder);
 if(path.dirname(root)!==path.resolve(os.tmpdir())||
   !/^vision-custody-durable-[A-Za-z0-9_-]+$/.test(path.basename(root)))
  throw new TypeError('Only synthetic test folder allowed');
 const st=fs.lstatSync(root);
 if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(root)!==root)
  throw new TypeError('Unsafe test folder');
 return root;
}
function lockInfo(root){
 const loc=path.join(root,'writer.lock');
 let stat;
 try{stat=fs.lstatSync(loc)}
 catch(e){if(e.code==='ENOENT')return {status:'NO_LOCK'};throw e}
 if(!stat.isDirectory()||stat.isSymbolicLink())
  return {status:'UNSAFE_LOCK'};
 let fd;
 try{
  const marker=path.join(loc,'owner.json');
  const st=fs.lstatSync(marker);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
    st.size<10||st.size>MAX_MARKER)return {status:'OWNER_UNKNOWN'};
  fd=fs.openSync(marker,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const actual=fs.fstatSync(fd);
  if(!actual.isFile()||actual.dev!==st.dev||actual.ino!==st.ino||
   actual.size!==st.size)return {status:'OWNER_UNKNOWN'};
  const bytes=fs.readFileSync(fd);
  const record=JSON.parse(bytes.toString('utf8'));
  if(!record||typeof record!=='object'||Array.isArray(record)||
   Object.keys(record).sort().join('|')!=='checksum|createdAt|nonce|pid|version'||
   record.version!==1||!Number.isSafeInteger(record.pid)||record.pid<1||
   record.pid>4_194_304||!NONCE.test(record.nonce)||
   typeof record.createdAt!=='string'||
   !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.createdAt)||
   !Number.isFinite(Date.parse(record.createdAt))||
   new Date(record.createdAt).toISOString()!==record.createdAt||
   !HEX.test(record.checksum)||record.checksum!==fingerprint(record))
   return {status:'OWNER_UNKNOWN'};
  return {status:'VALID_LOCK',record,ino:stat.ino,dev:stat.dev};
 }catch{return {status:'OWNER_UNKNOWN'}}
 finally{if(fd!==undefined)fs.closeSync(fd)}
}
function ownerState(pid){
 try{process.kill(pid,0);return 'ALIVE'}
 catch(e){
  if(e&&e.code==='ESRCH')return 'DEAD';
  return 'UNKNOWN';
 }
}
function stampSyntheticLock({directory}){
 const root=controlledDir(directory);
 const current=lockInfo(root);
 if(current.status!=='OWNER_UNKNOWN')throw new TypeError('Expected new empty synthetic lock');
 const lock=path.join(root,'writer.lock');
 if(fs.readdirSync(lock).length!==0)
  throw new TypeError('Lock already has contents');
 const basic={version:1,pid:process.pid,createdAt:new Date().toISOString(),
  nonce:randomBytes(16).toString('hex')};
 const bytes=JSON.stringify({...basic,checksum:fingerprint(basic)})+'\n';
 const fd=fs.openSync(path.join(lock,'owner.json'),fs.constants.O_WRONLY|
  fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 const folder=fs.openSync(lock,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
 try{fs.fsyncSync(folder)}finally{fs.closeSync(folder)}
 return {status:'STAMPED_SYNTHETIC_OWNER'};
}
function reviewOrphan({directory,chain,expectedPinnedHead}){
 const root=controlledDir(directory);
 if(typeof expectedPinnedHead!=='string'||!HEX.test(expectedPinnedHead))
  throw new TypeError('Expected a separate 256-bit head');
 let ledger;
 try{
  ledger=createDurableLabCustodian(chain,{directory:root,
   expectedPinnedHead}).read();
 }catch{return Object.freeze({status:'LEDGER_INVALID_OR_PIN_MISMATCH',
  canAutoUnlock:false,canDeployToProduction:false})}
 const lock=lockInfo(root);
 let status=lock.status;
 if(lock.status==='VALID_LOCK'){
  const live=ownerState(lock.record.pid);
  status=live==='ALIVE'?'OWNER_STILL_RUNNING':
   live==='DEAD'?'ORPHAN_REVIEW_REQUIRED':'OWNER_LIVENESS_UNKNOWN';
 }
 return Object.freeze({status,receipts:ledger.count,
  // Never export pid, nonce, head, absolute path or reference token.
  canAutoUnlock:false,canConnectStaging:false,canDeployToProduction:false});
}
function releaseReviewedOrphan({directory,chain,expectedPinnedHead,review}){
 const result=reviewOrphan({directory,chain,expectedPinnedHead});
 if(result.status!=='ORPHAN_REVIEW_REQUIRED')
  return Object.freeze({status:'LOCK_NOT_CLEARED',reason:result.status});
 if(!review||Object.keys(review).sort().join('|')!==
  'manualTicket|reviewerConfirmed|secondReviewerConfirmed'||
  review.reviewerConfirmed!==true||review.secondReviewerConfirmed!==true||
  !TICKET.test(review.manualTicket))
  return Object.freeze({status:'DUAL_REVIEW_REQUIRED'});
 const root=controlledDir(directory);
 // Re-check liveness, lock inode and ledger pin immediately before removal.
 const earlier=lockInfo(root);
 if(earlier.status!=='VALID_LOCK'||ownerState(earlier.record.pid)!=='DEAD')
  return Object.freeze({status:'LOCK_NOT_CLEARED',reason:'OWNER_OR_MARKER_CHANGED'});
 if(reviewOrphan({directory:root,chain,expectedPinnedHead}).status!=='ORPHAN_REVIEW_REQUIRED')
  return Object.freeze({status:'LOCK_NOT_CLEARED',reason:'LEDGER_OR_OWNER_CHANGED'});
 const current=lockInfo(root);
 if(current.status!=='VALID_LOCK'||current.dev!==earlier.dev||
  current.ino!==earlier.ino||current.record.checksum!==earlier.record.checksum||
  ownerState(current.record.pid)!=='DEAD'||
  fs.readdirSync(path.join(root,'writer.lock')).join('|')!=='owner.json')
  return Object.freeze({status:'LOCK_NOT_CLEARED',reason:'LOCK_CHANGED'});
 fs.unlinkSync(path.join(root,'writer.lock','owner.json'));
 fs.rmdirSync(path.join(root,'writer.lock'));
 // This is *only* a controlled local simulation with caller-declared approvals.
 return Object.freeze({status:'SIMULATED_MANUAL_LOCK_RELEASE',
  canAutoUnlock:false,canConnectStaging:false,canDeployToProduction:false});
}
module.exports={stampSyntheticLock,reviewOrphan,releaseReviewedOrphan};
