#!/usr/bin/env node
// OFFLINE LAB ONLY. Child deliberately exits mid-write; NO production paths.
// Expects a newly created private directory under OS tmp with fixture prefix.
// Models process termination, NOT actual power loss or distributed storage.
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {buildChain}=require('../fixtures/commercial-evidence-hash-chain.cjs');
const {issueLabAnchor,ZERO}=require('../fixtures/commercial-evidence-external-anchor.cjs');
const {createDurableLabCustodian}=require('../fixtures/commercial-evidence-durable-lab.cjs');
const {stampSyntheticLock}=require('../fixtures/commercial-evidence-lock-review-lab.cjs');

const phases=['AFTER_LOCK','AFTER_TEMP_SYNC','AFTER_RENAME','AFTER_DIR_SYNC'];
const folder=process.argv[2],phase=process.argv[3],round=Number(process.argv[4]);
function syntheticDirectory(dir){
 if(typeof dir!=='string'||path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||
  !/^vision-custody-durable-[A-Za-z0-9_-]+$/.test(path.basename(path.resolve(dir))))
  throw Error('Invalid synthetic directory');
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(dir)!==path.resolve(dir))
  throw Error('Unsafe synthetic directory');
 return path.resolve(dir);
}
function buildFixture(){
 const docs=path.resolve(__dirname,'../../docs/implementation');
 const load=name=>JSON.parse(fs.readFileSync(path.join(docs,name),'utf8'));
 const a=load('commercial-staging-evidence-template.json'),
  b=load('commercial-staging-evidence-lab-example.json');
 const chain=buildChain([
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:a},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:b},
  {sequence:3,recordedAt:'2026-10-15T12:15:00Z',form:structuredClone(b)}
 ]);
 const first=issueLabAnchor(chain,{recordCount:2,stampedAt:'2026-10-15T12:11:00Z'});
 const second=issueLabAnchor(chain,{previous:first,recordCount:3,
  stampedAt:'2026-10-15T12:16:00Z'});
 return {chain,first,second};
}
function crash(){
 const dir=syntheticDirectory(folder);
 if(!phases.includes(phase)||![1,2].includes(round))
  throw Error('Invalid synthetic crash phase');
 const {chain,first,second}=buildFixture();
 const snapshot=createDurableLabCustodian(chain,{directory:dir}).read();
 const expectedCount=round-1,expectedHead=round===1?ZERO:first.receiptHash;
 if(snapshot.count!==expectedCount||snapshot.head!==expectedHead)
  throw Error('Unexpected synthetic history state');
 const previous=round===1?{version:1,receipts:[],requests:[]}:
  JSON.parse(fs.readFileSync(path.join(dir,'ledger.json'),'utf8'));
 const receipt=round===1?first:second;
 const payload={version:1,receipts:[...previous.receipts,receipt],
  requests:[...previous.requests,{id:'REQ-'+String(round).padStart(8,'0'),
   receiptHash:receipt.receiptHash,expectedHead}]};
 const checksum=createHash('sha256').update('VISION-DURABLE-CUSTODY-LAB-V1\0')
  .update(JSON.stringify(payload)).digest('hex');
 const next={...payload,checksum};
 const lock=path.join(dir,'writer.lock');
 fs.mkdirSync(lock);
 stampSyntheticLock({directory:dir});
 if(phase==='AFTER_LOCK')process.exit(77);
 const temp=path.join(dir,'ledger-'+process.pid+'-'+Date.now()+'.tmp');
 const fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|
  fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(next)+'\n');fs.fsyncSync(fd)}
 finally{fs.closeSync(fd)}
 if(phase==='AFTER_TEMP_SYNC')process.exit(77);
 fs.renameSync(temp,path.join(dir,'ledger.json'));
 if(phase==='AFTER_RENAME')process.exit(77);
 const fdDir=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
 try{fs.fsyncSync(fdDir)}finally{fs.closeSync(fdDir)}
 // Kill/exit before sending ANY acknowledgement. No finally cleanup.
 process.exit(77);
}
try{crash()}catch{
 // Fail closed; never print credential, ledger bytes, OS path or digest.
 process.stderr.write('Synthetic crash worker refused or could not complete setup.\n');
 process.exitCode=1;
}
