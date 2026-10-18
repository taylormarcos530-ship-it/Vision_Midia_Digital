// OFFLINE LAB ONLY — read-only forensic inventory of interrupted synthetic quarantine.
// This helper makes NO filesystem modifications and does NOT authenticate reviewers,
// ledger history, file ownership, or a real independent pin. No auto-resolution.
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');

const TEMP=/^ledger-([1-9][0-9]{0,6})-([0-9]{13})\.tmp$/;
const HEX=/^[a-f0-9]{64}$/;
const MAX_BYTES=128*1024;
const noPrivileges=()=>({readOnly:true,ledgerVerified:false,canAutoResolve:false,
 canConnectStaging:false,canDeployToProduction:false});
const outcome=(status)=>Object.freeze({status,...noPrivileges()});
const digest=items=>createHash('sha256')
 .update('VISION-ORPHAN-TEMP-INVENTORY-V1\0')
 .update(JSON.stringify(items)).digest('hex');

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
function selectionIsValid(name,fingerprint){
 if(typeof name!=='string'||typeof fingerprint!=='string'||!HEX.test(fingerprint))
  return false;
 const match=TEMP.exec(name);
 return Boolean(match&&Number(match[1])<=4_194_304);
}
function readIdentity(filename){
 let fd;
 try{
  const before=fs.lstatSync(filename);
  if(!before.isFile()||before.isSymbolicLink()||!Number.isSafeInteger(before.nlink)||
   before.nlink<1||before.nlink>2||before.size<1||before.size>MAX_BYTES)
   return {status:'UNSAFE'};
  fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const after=fs.fstatSync(fd);
  if(!after.isFile()||after.dev!==before.dev||after.ino!==before.ino||
   after.size!==before.size||after.mtimeMs!==before.mtimeMs||
   after.nlink!==before.nlink)return {status:'UNSAFE'};
  const bytes=fs.readFileSync(fd);
  if(bytes.length!==before.size)return {status:'UNSAFE'};
  return {status:'PRESENT',dev:after.dev,ino:after.ino,nlink:after.nlink,
   fingerprint:digest([after.dev,after.ino,after.size,after.mtimeMs,
    createHash('sha256').update(bytes).digest('hex')])};
 }catch(e){return {status:e&&e.code==='ENOENT'?'ABSENT':'UNSAFE'}}
 finally{if(fd!==undefined)fs.closeSync(fd)}
}
function inspectInterruptedQuarantine({directory,name,expectedFingerprint}={}){
 if(!selectionIsValid(name,expectedFingerprint))return outcome('INVALID_SELECTION');
 const root=controlledDirectory(directory);
 // Dangling symlinks also count as locks. Never declare a pair resolved while locked.
 try{fs.lstatSync(path.join(root,'writer.lock'));return outcome('LOCK_PRESENT_REVIEW_REQUIRED')}
 catch(e){if(e.code!=='ENOENT')return outcome('LOCK_CHECK_UNAVAILABLE')}
 const folder=path.join(root,'quarantine');
 let folderExists=false;
 try{
  const st=fs.lstatSync(folder);
  if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(folder)!==folder)
   return outcome('UNSAFE_QUARANTINE_DIRECTORY');
  folderExists=true;
 }catch(e){if(e.code!=='ENOENT')return outcome('UNSAFE_QUARANTINE_DIRECTORY')}
 const source=readIdentity(path.join(root,name));
 const destination=folderExists?readIdentity(path.join(folder,
  name+'.'+expectedFingerprint.slice(0,16)+'.quarantined')):{status:'ABSENT'};
 if(source.status==='UNSAFE'||destination.status==='UNSAFE')
  return outcome('UNSAFE_FILE_REVIEW_REQUIRED');
 if(source.status==='ABSENT'&&destination.status==='ABSENT')
  return outcome('NO_MATCHING_FILES');
 // Two present but different files can never be a valid interrupted hardlink
 // transfer, even when one happened to retain the originally selected bytes.
 if(source.status==='PRESENT'&&destination.status==='PRESENT'&&
   (source.dev!==destination.dev||source.ino!==destination.ino||
    source.nlink!==2||destination.nlink!==2))
  return outcome('CONFLICTING_FILES_REVIEW_REQUIRED');
 if(source.status==='PRESENT'&&source.fingerprint!==expectedFingerprint||
    destination.status==='PRESENT'&&destination.fingerprint!==expectedFingerprint)
  return outcome('SELECTION_CHANGED_REVIEW_REQUIRED');
 if(source.status==='PRESENT'&&destination.status==='ABSENT')
  return outcome(source.nlink===1?'SOURCE_ONLY_REVIEW_REQUIRED':'UNSAFE_FILE_REVIEW_REQUIRED');
 if(source.status==='ABSENT'&&destination.status==='PRESENT')
  return outcome(destination.nlink===1?'DESTINATION_ONLY_REVIEW_REQUIRED':'UNSAFE_FILE_REVIEW_REQUIRED');
 // Same inode, same byte fingerprint, exactly two links: likely interrupted
 // between creating a hardlink and unlinking the temporary name. No mutation.
 return outcome('PAIRED_HARDLINK_REVIEW_REQUIRED');
}
module.exports={inspectInterruptedQuarantine};
