// OFFLINE LAB ONLY — inspect and quarantine synthetic abandoned *.tmp files.
// No service integration, production access or automatic recovery.
// Exclusive hardlink makes a review copy; source is NEVER unlinked by this lab.
// Approvals are simulated, NOT authenticated. Never reuse in live custody.
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createDurableLabCustodian}=require('./commercial-evidence-durable-lab.cjs');
const {verifyLabAnchors,ZERO}=require('./commercial-evidence-external-anchor.cjs');

const HEX=/^[a-f0-9]{64}$/;
const TICKET=/^LAB-TICKET-[0-9]{6}$/;
const TEMP=/^ledger-([1-9][0-9]{0,6})-([0-9]{13})\.tmp$/;
const MAX=128*1024;
const CHECKSUM_PREFIX='VISION-DURABLE-CUSTODY-LAB-V1\0';
const inventoryHash=data=>createHash('sha256').update('VISION-ORPHAN-TEMP-INVENTORY-V1\0')
 .update(JSON.stringify(data)).digest('hex');
const checksum=core=>createHash('sha256').update(CHECKSUM_PREFIX)
 .update(JSON.stringify(core)).digest('hex');
const exact=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).sort().join('|')===names.slice().sort().join('|');
const immutable=value=>Object.freeze(value);
const restricted=()=>({canAutoQuarantine:false,canConnectStaging:false,
 canDeployToProduction:false});

function controlledDirectory(directory){
 if(typeof directory!=='string')throw new TypeError('Only synthetic test directory');
 const root=path.resolve(directory);
 if(path.dirname(root)!==path.resolve(os.tmpdir())||
  !/^vision-custody-durable-[A-Za-z0-9_-]+$/.test(path.basename(root)))
  throw new TypeError('Only synthetic test directory');
 const st=fs.lstatSync(root);
 if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(root)!==root)
  throw new TypeError('Unsafe synthetic test directory');
 return root;
}
function tempName(name){
 if(typeof name!=='string')return false;
 const match=TEMP.exec(name);
 return Boolean(match&&Number(match[1])<=4194304);
}
function safeRead(file){
 let fd;
 try{
  const before=fs.lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
   before.size<1||before.size>MAX)return {status:'UNSAFE_FILE'};
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const after=fs.fstatSync(fd);
  if(!after.isFile()||after.dev!==before.dev||after.ino!==before.ino||
   after.size!==before.size||after.nlink!==1)return {status:'UNSAFE_FILE'};
  const bytes=fs.readFileSync(fd);
  if(bytes.length!==before.size)return {status:'UNSAFE_FILE'};
  return {status:'READ',bytes,fingerprint:inventoryHash([
   after.dev,after.ino,after.size,after.mtimeMs,
   createHash('sha256').update(bytes).digest('hex')])};
 }catch(e){return {status:e.code==='ENOENT'?'MISSING_FILE':'UNSAFE_FILE'};}
 finally{if(fd!==undefined)fs.closeSync(fd)}
}
function validateTemp(bytes,chain,ledger,committed){
 try{
  const state=JSON.parse(bytes.toString('utf8'));
  if(!exact(state,['version','receipts','requests','checksum'])||state.version!==1||
   !Array.isArray(state.receipts)||!Array.isArray(state.requests)||
   state.receipts.length<1||state.receipts.length>30||
   state.requests.length!==state.receipts.length||!HEX.test(state.checksum))
   return 'INVALID_TEMP';
  const core={version:state.version,receipts:state.receipts,requests:state.requests};
  if(checksum(core)!==state.checksum)return 'INVALID_TEMP';
  const count=state.receipts.at(-1)?.recordCount;
  if(!Number.isSafeInteger(count)||count<1||count>chain.length||
   !verifyLabAnchors(chain.slice(0,count),state.receipts).locallyConsistent)
   return 'INVALID_TEMP';
  const ids=new Set();
  for(let i=0;i<state.requests.length;i++){
   const row=state.requests[i],receipt=state.receipts[i];
   if(!exact(row,['id','receiptHash','expectedHead'])||
    !/^REQ-[A-Z0-9]{8}$/.test(row.id)||ids.has(row.id)||
    row.receiptHash!==receipt.receiptHash||
    row.expectedHead!==(i===0?ZERO:state.receipts[i-1].receiptHash))
    return 'INVALID_TEMP';
   ids.add(row.id);
  }
  // A matching head alone is insufficient: do not mislabel an altered
  // historical idempotency map as a continuation or committed duplicate.
  const matchesHistory=Boolean(committed&&
   JSON.stringify(state.receipts.slice(0,ledger.count))===
    JSON.stringify(committed.receipts)&&
   JSON.stringify(state.requests.slice(0,ledger.count))===
    JSON.stringify(committed.requests));
  if(!matchesHistory)return 'UNRECOGNIZED_TEMP';
  if(state.receipts.length===ledger.count+1 &&
   state.requests[ledger.count].expectedHead===ledger.head)
   return 'NEXT_UNCOMMITTED';
  if(state.receipts.length===ledger.count&&
   state.receipts.at(-1).receiptHash===ledger.head)
   return 'DUPLICATE_COMMITTED';
  return 'UNRECOGNIZED_TEMP';
 }catch{return 'INVALID_TEMP'}
}
function snapshot({directory,chain,expectedPinnedHead}){
 const root=controlledDirectory(directory);
 if(typeof expectedPinnedHead!=='string'||!HEX.test(expectedPinnedHead))
  throw new TypeError('Expected independent synthetic pinned head');
 let ledger;
 try{ledger=createDurableLabCustodian(chain,{directory:root,expectedPinnedHead}).read()}
 catch{return {root,status:'LEDGER_INVALID_OR_PIN_MISMATCH',candidates:[]}}
 // Read an independent snapshot of confirmed history to compare ALL prior
 // receipts and request bindings, rather than matching only the final hash.
 let committed={version:1,receipts:[],requests:[]};
 if(ledger.count){
  const copy=safeRead(path.join(root,'ledger.json'));
  if(copy.status!=='READ')
   return {root,status:'LEDGER_INVALID_OR_PIN_MISMATCH',candidates:[]};
  try{
   committed=JSON.parse(copy.bytes.toString('utf8'));
   if(!Array.isArray(committed.receipts)||!Array.isArray(committed.requests)||
    committed.receipts.length!==ledger.count||
    committed.receipts.at(-1)?.receiptHash!==ledger.head)
    throw Error('Ledger moved');
  }catch{return {root,status:'LEDGER_INVALID_OR_PIN_MISMATCH',candidates:[]}}
 }
 // Any lock presence, including an unsafe symlink, forbids quarantine.
 let locked=false;
 try{fs.lstatSync(path.join(root,'writer.lock'));locked=true}
 catch(e){if(e.code!=='ENOENT')locked=true}
 const candidates=[];
 for(const name of fs.readdirSync(root)){
  if(!tempName(name))continue;
  const file=safeRead(path.join(root,name));
  candidates.push(immutable({name,status:file.status==='READ'?
   validateTemp(file.bytes,chain,ledger,committed):file.status,
   ...(file.status==='READ'?{fingerprint:file.fingerprint}:{})}));
 }
 candidates.sort((a,b)=>a.name.localeCompare(b.name));
 return {root,status:locked?'LOCK_PRESENT':'READY',candidates};
}
function inspectOrphanTemps(options){
 const state=snapshot(options);
 return immutable({status:state.status,candidates:immutable(state.candidates),
  ...restricted()});
}
function quarantineOrphanTemp({directory,chain,expectedPinnedHead,name,
 expectedFingerprint,review}={}){
 if(!tempName(name)||typeof expectedFingerprint!=='string'||!HEX.test(expectedFingerprint))
  return immutable({status:'INVALID_SELECTION',...restricted()});
 if(!review||!exact(review,['manualTicket','reviewerConfirmed','secondReviewerConfirmed'])||
  review.reviewerConfirmed!==true||review.secondReviewerConfirmed!==true||
  !TICKET.test(review.manualTicket))
  return immutable({status:'DUAL_REVIEW_REQUIRED',...restricted()});
 const before=snapshot({directory,chain,expectedPinnedHead});
 if(before.status!=='READY')return immutable({status:'QUARANTINE_BLOCKED',
  reason:before.status,...restricted()});
 const candidate=before.candidates.find(x=>x.name===name);
 if(!candidate)return immutable({status:'CANDIDATE_NOT_FOUND',...restricted()});
 if(!['NEXT_UNCOMMITTED','DUPLICATE_COMMITTED'].includes(candidate.status))
  return immutable({status:'CANDIDATE_NOT_VERIFIED',...restricted()});
 if(candidate.fingerprint!==expectedFingerprint)
  return immutable({status:'CANDIDATE_CHANGED',...restricted()});
 // Revalidate the ledger pin, lock, inode, bytes and candidate immediately before move.
 const now=snapshot({directory,chain,expectedPinnedHead});
 const selected=now.candidates.find(x=>x.name===name);
 if(now.status!=='READY'||!selected||selected.status!==candidate.status||
  selected.fingerprint!==expectedFingerprint)
  return immutable({status:'QUARANTINE_BLOCKED',reason:'STATE_CHANGED',...restricted()});
 const target=path.join(now.root,'quarantine');
 try{fs.mkdirSync(target,{mode:0o700})}
 catch(e){if(e.code!=='EEXIST')throw e}
 const stat=fs.lstatSync(target);
 if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(target)!==target)
  return immutable({status:'UNSAFE_QUARANTINE_FOLDER',...restricted()});
 const dest=path.join(target,name+'.'+expectedFingerprint.slice(0,16)+'.quarantined');
 const source=path.join(now.root,name);
 // lstat instead of existsSync: a dangling writer.lock symlink still blocks.
 try{
  fs.lstatSync(path.join(now.root,'writer.lock'));
  return immutable({status:'QUARANTINE_BLOCKED',reason:'LOCK_PRESENT',...restricted()});
 }catch(e){if(e.code!=='ENOENT')return immutable({status:'QUARANTINE_BLOCKED',
  reason:'LOCK_CHECK_FAILED',...restricted()})}
 if(safeRead(source).fingerprint!==expectedFingerprint)
  return immutable({status:'QUARANTINE_BLOCKED',reason:'STATE_CHANGED',...restricted()});
 // Atomic NO-REPLACE destination creation on this local filesystem.
 // Unlike renameSync(), linkSync() fails if a concurrent actor creates dest.
 // No path is unlinked: name reuse between stat and unlink cannot be excluded.
 try{fs.linkSync(source,dest)}
 catch(e){
  if(e.code==='EEXIST')return immutable({status:'QUARANTINE_COLLISION',...restricted()});
  return immutable({status:'QUARANTINE_BLOCKED',reason:'LINK_FAILED',...restricted()});
 }
 try{
  const from=fs.lstatSync(source),to=fs.lstatSync(dest);
  if(!from.isFile()||!to.isFile()||from.isSymbolicLink()||to.isSymbolicLink()||
   from.dev!==to.dev||from.ino!==to.ino||from.nlink!==2||to.nlink!==2||
   from.size!==to.size||from.size>MAX||from.size<1||
   inventoryHash([to.dev,to.ino,to.size,to.mtimeMs,
    createHash('sha256').update(fs.readFileSync(dest)).digest('hex')])!==expectedFingerprint)
   return immutable({status:'QUARANTINE_INCOMPLETE',reason:'LINK_CHANGED',...restricted()});
  // Deliberate fail-closed policy: inode verification followed by pathname
  // unlink is not atomic. Another actor may replace the source between the
  // two syscalls. Keep BOTH hardlink names, never delete a source path.
  const final=fs.lstatSync(dest);
  if(!final.isFile()||final.isSymbolicLink()||final.ino!==to.ino||
   final.dev!==to.dev||final.nlink!==2)
   return immutable({status:'QUARANTINE_INCOMPLETE',reason:'POST_COPY_CHECK_FAILED',
    ...restricted()});
  for(const dir of [target,now.root]){
   const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
   try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  }
 }catch{
  // Never auto-delete either name after an interrupted or ambiguous copy.
  // An operator must inspect both local paths before any further action.
  return immutable({status:'QUARANTINE_INCOMPLETE',reason:'REVIEW_REQUIRED',
   ...restricted()});
 }
 return immutable({status:'QUARANTINE_COPY_REVIEW_REQUIRED',name,
  ...restricted()});
}
module.exports={inspectOrphanTemps,quarantineOrphanTemp};
