// OFFLINE LAB: quarantine checks use only synthetic subprocesses and os.tmpdir().
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {buildChain}=require('./fixtures/commercial-evidence-hash-chain.cjs');
const {issueLabAnchor,ZERO}=require('./fixtures/commercial-evidence-external-anchor.cjs');
const {createDurableLabCustodian}=require('./fixtures/commercial-evidence-durable-lab.cjs');
const {releaseReviewedOrphan}=require('./fixtures/commercial-evidence-lock-review-lab.cjs');
const {inspectOrphanTemps,quarantineOrphanTemp}
 =require('./fixtures/commercial-evidence-temp-quarantine-lab.cjs');

const approvals={reviewerConfirmed:true,secondReviewerConfirmed:true,
 manualTicket:'LAB-TICKET-000001'};
const file=name=>JSON.parse(fs.readFileSync(path.join('docs/implementation',name),'utf8'));
function fixture(){
 const a=file('commercial-staging-evidence-template.json'),
  b=file('commercial-staging-evidence-lab-example.json');
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
function sandbox(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-custody-durable-'));
 try{return fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
function childExit(dir,phase,round=1){
 const p=spawnSync(process.execPath,['tests/tools/commercial-evidence-crash-worker.cjs',
  dir,phase,String(round)],{cwd:process.cwd(),encoding:'utf8',timeout:20000});
 assert.equal(p.status,77,p.stderr);
 assert.equal(p.stdout,'');assert.equal(p.stderr,'');
}
const opts=(dir,chain,pin=ZERO)=>({directory:dir,chain,expectedPinnedHead:pin});
const temp=(dir)=>fs.readdirSync(dir).find(x=>x.endsWith('.tmp'));
const move=(options,candidate,review=approvals)=>quarantineOrphanTemp({
 ...options,name:candidate.name,expectedFingerprint:candidate.fingerprint,review});
function release(dir,chain,pin){
 assert.equal(releaseReviewedOrphan({...opts(dir,chain,pin),review:approvals}).status,
  'SIMULATED_MANUAL_LOCK_RELEASE');
}
test('inspection without a candidate is read-only and never invents commits',()=>sandbox(dir=>{
 const {chain}=fixture(),a=opts(dir,chain),before=fs.readdirSync(dir);
 const result=inspectOrphanTemps(a);
 assert.equal(result.status,'READY');assert.equal(result.candidates.length,0);
 assert.equal(result.canAutoQuarantine,false);
 assert.equal(result.canConnectStaging,false);
 assert.equal(result.canDeployToProduction,false);
 assert.deepEqual(fs.readdirSync(dir),before);
}));
test('crash-created pending temporary file is inventoried but cannot be committed',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');
 const result=inspectOrphanTemps(opts(dir,chain));
 assert.equal(result.status,'LOCK_PRESENT');
 assert.equal(result.candidates.length,1);
 assert.equal(result.candidates[0].status,'NEXT_UNCOMMITTED');
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,0);
 assert.equal(fs.existsSync(path.join(dir,'ledger.json')),false);
 assert.ok(temp(dir));
}));
test('unreleased or unexpected lock blocks quarantine even after dual review',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 const result=move(a,candidate);
 assert.equal(result.status,'QUARANTINE_BLOCKED');
 assert.equal(result.reason,'LOCK_PRESENT');
 assert.ok(temp(dir));
}));
test('dual reviewed lock release is separate from dual reviewed quarantine',()=>sandbox(dir=>{
 const {chain,first}=fixture();childExit(dir,'AFTER_TEMP_SYNC');
 release(dir,chain,ZERO);
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 for(const review of [null,{}, {...approvals,secondReviewerConfirmed:false},
  {...approvals,manualTicket:'INVALID'}, {...approvals,productionAuthorized:true}])
  assert.equal(move(a,candidate,review).status,'DUAL_REVIEW_REQUIRED');
 assert.ok(temp(dir));
 const result=move(a,candidate);
 assert.equal(result.status,'QUARANTINE_COPY_REVIEW_REQUIRED');
 assert.equal(result.canAutoQuarantine,false);
 assert.equal(fs.readdirSync(path.join(dir,'quarantine')).length,1);
 assert.ok(temp(dir)); // source remains for independent human review
 const ledger=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(ledger.read().count,0);
 assert.equal(ledger.publish({receipt:first,expectedHead:ZERO,
  requestId:'REQ-00000001'}).status,'COMMITTED');
 assert.equal(ledger.read().count,1);
}));
test('committed ledger remains untouched while a second receipt temp is quarantined',()=>sandbox(dir=>{
 const {chain,first,second}=fixture();
 const writer=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(writer.publish({receipt:first,expectedHead:ZERO,
  requestId:'REQ-00000001'}).status,'COMMITTED');
 const original=fs.readFileSync(path.join(dir,'ledger.json'));
 childExit(dir,'AFTER_TEMP_SYNC',2);
 release(dir,chain,first.receiptHash);
 const a=opts(dir,chain,first.receiptHash);
 assert.equal(move(a,inspectOrphanTemps(a).candidates[0]).status,'QUARANTINE_COPY_REVIEW_REQUIRED');
 assert.deepEqual(fs.readFileSync(path.join(dir,'ledger.json')),original);
 assert.equal(writer.read().count,1);
 assert.equal(writer.publish({receipt:second,expectedHead:first.receiptHash,
  requestId:'REQ-00000002'}).status,'COMMITTED');
 assert.equal(writer.read().count,2);
}));
test('mismatched independent head prevents inventory approval and quarantine',()=>sandbox(dir=>{
 const {chain,first}=fixture();childExit(dir,'AFTER_TEMP_SYNC');
 release(dir,chain,ZERO);
 const good=inspectOrphanTemps(opts(dir,chain));
 const wrong=opts(dir,chain,first.receiptHash);
 assert.equal(inspectOrphanTemps(wrong).status,'LEDGER_INVALID_OR_PIN_MISMATCH');
 assert.equal(move(wrong,good.candidates[0]).status,'QUARANTINE_BLOCKED');
 assert.ok(temp(dir));
}));
test('a modified file after inspection is not quarantined with stale fingerprint',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 fs.appendFileSync(path.join(dir,candidate.name),'x');
 assert.equal(move(a,candidate).status,'CANDIDATE_NOT_VERIFIED');
 assert.ok(temp(dir));
}));
test('symlink with plausible temp name never moves or touches external target',()=>sandbox(dir=>{
 const {chain}=fixture();
 const external=fs.mkdtempSync(path.join(os.tmpdir(),'vision-external-'));
 try{
  const target=path.join(external,'protected.txt');fs.writeFileSync(target,'do not alter');
  const fake='ledger-123-1770000000000.tmp';fs.symlinkSync(target,path.join(dir,fake));
  const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
  assert.equal(candidate.status,'UNSAFE_FILE');
  assert.equal(move({...a}, {...candidate,fingerprint:'0'.repeat(64)}).status,
   'CANDIDATE_NOT_VERIFIED');
  assert.equal(fs.readFileSync(target,'utf8'),'do not alter');
  assert.equal(fs.lstatSync(path.join(dir,fake)).isSymbolicLink(),true);
 }finally{fs.rmSync(external,{recursive:true,force:true})}
}));
test('hard linked plausible temp is never moved or used to affect another file',()=>sandbox(dir=>{
 const {chain}=fixture();const external=path.join(dir,'protected.data');
 fs.writeFileSync(external,'keep');
 const name='ledger-123-1770000000000.tmp';fs.linkSync(external,path.join(dir,name));
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 assert.equal(candidate.status,'UNSAFE_FILE');
 assert.equal(move(a,{...candidate,fingerprint:'0'.repeat(64)}).status,
  'CANDIDATE_NOT_VERIFIED');
 assert.equal(fs.readFileSync(external,'utf8'),'keep');
}));
test('unknown names and sibling files are untouched during an approved move',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 for(const name of ['notes.txt','ledger-123-1770000000000.tmp.bak','other.tmp'])
  fs.writeFileSync(path.join(dir,name),'keep');
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 // Unrecognized sibling names (including other.tmp) must not enter inventory.
 assert.equal(inspectOrphanTemps(a).candidates.length,1);
 assert.equal(move(a,candidate).status,'QUARANTINE_COPY_REVIEW_REQUIRED');
 for(const name of ['notes.txt','ledger-123-1770000000000.tmp.bak','other.tmp'])
  assert.equal(fs.readFileSync(path.join(dir,name),'utf8'),'keep');
}));
test('no traversal, path injection or unrelated directory is selectable',()=>sandbox(dir=>{
 const {chain}=fixture(),a=opts(dir,chain);
 for(const name of ['../ledger-1-1770000000000.tmp',
  '/tmp/ledger-1-1770000000000.tmp','ledger-1-1770000000000.tmp/../a',
  'writer.lock','ledger.json','other.tmp']){
  assert.equal(quarantineOrphanTemp({...a,name,
   expectedFingerprint:'0'.repeat(64),review:approvals}).status,'INVALID_SELECTION');
 }
 for(const directory of [process.cwd(),os.tmpdir(),'/mnt/data']){
  assert.throws(()=>inspectOrphanTemps(opts(directory,chain)),
   /Only synthetic test directory/);
 }
}));
test('unsafe quarantine folder symlink cannot redirect moved file externally',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const external=fs.mkdtempSync(path.join(os.tmpdir(),'vision-external-'));
 try{
  fs.symlinkSync(external,path.join(dir,'quarantine'));
  const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
  assert.equal(move(a,candidate).status,'UNSAFE_QUARANTINE_FOLDER');
  assert.ok(temp(dir));assert.deepEqual(fs.readdirSync(external),[]);
 }finally{fs.rmSync(external,{recursive:true,force:true})}
}));
test('existing destination is not overwritten on a repeated quarantine selection',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 fs.mkdirSync(path.join(dir,'quarantine'));
 const dest=path.join(dir,'quarantine',candidate.name+'.'+
  candidate.fingerprint.slice(0,16)+'.quarantined');
 fs.writeFileSync(dest,'preserve this');
 assert.equal(move(a,candidate).status,'QUARANTINE_COLLISION');
 assert.equal(fs.readFileSync(dest,'utf8'),'preserve this');
 assert.ok(temp(dir));
}));
test('review copy cannot be duplicated or mistaken for committed receipt',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 assert.equal(move(a,candidate).status,'QUARANTINE_COPY_REVIEW_REQUIRED');
 // Source nlink becomes 2 after the safe hardlink copy, so repeat selection
 // is refused before destination collision handling.
 assert.equal(move(a,candidate).status,'CANDIDATE_NOT_VERIFIED');
 assert.equal(fs.readdirSync(path.join(dir,'quarantine')).length,1);
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,0);
 assert.equal(fs.existsSync(path.join(dir,'ledger.json')),false);
}));
test('corrupted ledger prevents moving even otherwise valid pending temp',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 fs.writeFileSync(path.join(dir,'ledger.json'),'{');
 assert.equal(move(a,candidate).status,'QUARANTINE_BLOCKED');
 assert.ok(temp(dir));
}));
test('a duplicate already-committed temporary copy is quarantined, never adopted',()=>sandbox(dir=>{
 const {chain,first}=fixture();
 const writer=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(writer.publish({receipt:first,expectedHead:ZERO,
  requestId:'REQ-00000001'}).status,'COMMITTED');
 const original=fs.readFileSync(path.join(dir,'ledger.json'));
 const name='ledger-123-1770000000000.tmp';
 fs.writeFileSync(path.join(dir,name),original);
 const a=opts(dir,chain,first.receiptHash);
 const candidate=inspectOrphanTemps(a).candidates[0];
 assert.equal(candidate.status,'DUPLICATE_COMMITTED');
 assert.equal(move(a,candidate).status,'QUARANTINE_COPY_REVIEW_REQUIRED');
 assert.deepEqual(fs.readFileSync(path.join(dir,'ledger.json')),original);
 assert.equal(writer.read().count,1);
 assert.equal(writer.publish({receipt:first,expectedHead:ZERO,
  requestId:'REQ-00000001'}).status,'ALREADY_COMMITTED');
}));
test('malformed synthetic temp never passes quarantine, even with review',()=>sandbox(dir=>{
 const {chain}=fixture(),name='ledger-123-1770000000000.tmp';
 fs.writeFileSync(path.join(dir,name),'not-json');
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 assert.equal(candidate.status,'INVALID_TEMP');
 assert.equal(move(a,{...candidate,fingerprint:'0'.repeat(64)}).status,
  'CANDIDATE_NOT_VERIFIED');
 assert.equal(fs.readFileSync(path.join(dir,name),'utf8'),'not-json');
}));
test('all helpers remain offline and do not authorize remote or automatic deletion',()=>{
 const file='tests/fixtures/commercial-evidence-temp-quarantine-lab.cjs';
 const src=fs.readFileSync(file,'utf8');
 assert.match(src,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(src,/\b(?:fetch|axios|supabaseClient|execSync|rmSync)\s*\(/);
 assert.match(src,/canDeployToProduction:false/);
 assert.match(src,/fs\.linkSync\(/);
 assert.doesNotMatch(src,/fs\.unlinkSync\(/);
});

// Next regression: adversarial review of the same synthetic local namespace.
const digest=core=>createHash('sha256').update('VISION-DURABLE-CUSTODY-LAB-V1\0')
 .update(JSON.stringify(core)).digest('hex');
function retag(file,mutate){
 const state=JSON.parse(fs.readFileSync(file,'utf8'));
 mutate(state);
 const core={version:state.version,receipts:state.receipts,requests:state.requests};
 fs.writeFileSync(file,JSON.stringify({...core,checksum:digest(core)})+'\n');
}
test('quarantine creates one review copy without erasing either pending temp',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const original=temp(dir),copy='ledger-123-1770000000000.tmp';
 fs.copyFileSync(path.join(dir,original),path.join(dir,copy));
 const a=opts(dir,chain),inventory=inspectOrphanTemps(a);
 assert.equal(inventory.candidates.length,2);
 assert.deepEqual(inventory.candidates.map(x=>x.name),
  [...inventory.candidates.map(x=>x.name)].sort());
 assert.ok(inventory.candidates.every(x=>x.status==='NEXT_UNCOMMITTED'));
 assert.equal(move(a,inventory.candidates[0]).status,'QUARANTINE_COPY_REVIEW_REQUIRED');
 assert.equal(fs.readdirSync(path.join(dir,'quarantine')).length,1);
 assert.equal(inspectOrphanTemps(a).candidates.length,2);
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,0);
}));
test('changed historical request binding cannot masquerade as next commit',()=>sandbox(dir=>{
 const {chain,first}=fixture();
 createDurableLabCustodian(chain,{directory:dir}).publish({
  receipt:first,expectedHead:ZERO,requestId:'REQ-00000001'});
 childExit(dir,'AFTER_TEMP_SYNC',2);release(dir,chain,first.receiptHash);
 const filename=temp(dir);
 retag(path.join(dir,filename),state=>{state.requests[0].id='REQ-99999999'});
 const a=opts(dir,chain,first.receiptHash),candidate=inspectOrphanTemps(a).candidates[0];
 assert.equal(candidate.status,'UNRECOGNIZED_TEMP');
 assert.equal(move(a,candidate).status,'CANDIDATE_NOT_VERIFIED');
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,1);
 assert.ok(temp(dir));
}));
test('matching committed receipt with altered request ID is not a duplicate',()=>sandbox(dir=>{
 const {chain,first}=fixture(),writer=createDurableLabCustodian(chain,{directory:dir});
 writer.publish({receipt:first,expectedHead:ZERO,requestId:'REQ-00000001'});
 const filename='ledger-123-1770000000000.tmp';
 fs.copyFileSync(path.join(dir,'ledger.json'),path.join(dir,filename));
 retag(path.join(dir,filename),state=>{state.requests[0].id='REQ-99999999'});
 const a=opts(dir,chain,first.receiptHash),candidate=inspectOrphanTemps(a).candidates[0];
 assert.equal(candidate.status,'UNRECOGNIZED_TEMP');
 assert.equal(move(a,candidate).status,'CANDIDATE_NOT_VERIFIED');
 assert.equal(writer.read().head,first.receiptHash);
}));
test('new destination created during link cannot overwrite another file',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 const destination=path.join(dir,'quarantine',candidate.name+'.'+
  candidate.fingerprint.slice(0,16)+'.quarantined');
 const link=fs.linkSync;
 fs.linkSync=function(source,target){
  fs.writeFileSync(target,'FOREIGN DATA - PRESERVE');
  return link.call(fs,source,target);
 };
 let result;
 try{result=move(a,candidate)}finally{fs.linkSync=link}
 assert.equal(result.status,'QUARANTINE_COLLISION');
 assert.equal(fs.readFileSync(destination,'utf8'),'FOREIGN DATA - PRESERVE');
 assert.ok(temp(dir));
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,0);
}));
test('review copy does not call unlink even if unlink would fail',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 const unlink=fs.unlinkSync;
 fs.unlinkSync=function(){throw Object.assign(new Error('Simulated local interruption'),{code:'EIO'})};
 let result;
 try{result=move(a,candidate)}finally{fs.unlinkSync=unlink}
 assert.equal(result.status,'QUARANTINE_COPY_REVIEW_REQUIRED');
 const original=path.join(dir,candidate.name);
 const quarantined=fs.readdirSync(path.join(dir,'quarantine'));
 assert.equal(quarantined.length,1);
 assert.deepEqual(fs.readFileSync(original),
  fs.readFileSync(path.join(dir,'quarantine',quarantined[0])));
 assert.equal(fs.statSync(original).nlink,2);
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,0);
}));
test('source content replaced at link boundary is not reported as quarantined',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 const link=fs.linkSync;
 fs.linkSync=function(source,target){
  fs.appendFileSync(source,'SYNTHETIC TAMPER');
  return link.call(fs,source,target);
 };
 let result;
 try{result=move(a,candidate)}finally{fs.linkSync=link}
 assert.equal(result.status,'QUARANTINE_INCOMPLETE');
 assert.equal(result.reason,'LINK_CHANGED');
 assert.ok(temp(dir));
 assert.equal(fs.statSync(path.join(dir,candidate.name)).nlink,2);
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,0);
}));
test('unrelated items in existing quarantine folder survive review copy',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const q=path.join(dir,'quarantine');fs.mkdirSync(q);
 fs.writeFileSync(path.join(q,'foreign.txt'),'DO NOT TOUCH');
 fs.mkdirSync(path.join(q,'other-folder'));
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 assert.equal(move(a,candidate).status,'QUARANTINE_COPY_REVIEW_REQUIRED');
 assert.equal(fs.readFileSync(path.join(q,'foreign.txt'),'utf8'),'DO NOT TOUCH');
 assert.equal(fs.statSync(path.join(q,'other-folder')).isDirectory(),true);
 assert.equal(fs.readdirSync(q).length,3);
}));
test('disappeared selected temp never manufactures a committed receipt',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 fs.unlinkSync(path.join(dir,candidate.name)); // setup only; not a quarantine action
 assert.equal(move(a,candidate).status,'CANDIDATE_NOT_FOUND');
 assert.equal(fs.existsSync(path.join(dir,'ledger.json')),false);
 assert.equal(fs.existsSync(path.join(dir,'quarantine')),false);
}));

// Safety regression: a foreign source name must remain untouched when it is
// swapped in after our exclusive hardlink is made. This is a fixture-only race.
test('source swapped after hardlink is preserved; no pathname unlink occurs',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 const source=path.join(dir,candidate.name),foreign='FOREIGN_SENTINEL';
 const origLink=fs.linkSync,origUnlink=fs.unlinkSync;
 fs.linkSync=function(from,to){
  origLink(from,to);
  // An unrelated actor reuses the source name at the syscall boundary.
  origUnlink(from);
  fs.writeFileSync(from,foreign);
 };
 try{
  const result=move(a,candidate);
  assert.equal(result.status,'QUARANTINE_INCOMPLETE');
  assert.equal(result.reason,'LINK_CHANGED');
  assert.equal(fs.readFileSync(source,'utf8'),foreign);
  assert.equal(fs.readdirSync(path.join(dir,'quarantine')).length,1);
 }finally{fs.linkSync=origLink}
}));
test('normal review copy retains source and reports no automatic release',()=>sandbox(dir=>{
 const {chain}=fixture();childExit(dir,'AFTER_TEMP_SYNC');release(dir,chain,ZERO);
 const a=opts(dir,chain),candidate=inspectOrphanTemps(a).candidates[0];
 const source=path.join(dir,candidate.name);
 const origUnlink=fs.unlinkSync;let called=false;
 fs.unlinkSync=()=>{called=true;throw Error('Unexpected delete')};
 try{
  const result=move(a,candidate);
  assert.equal(result.status,'QUARANTINE_COPY_REVIEW_REQUIRED');
  assert.equal(result.canAutoQuarantine,false);
  assert.equal(fs.readFileSync(source).length>0,true);
  assert.equal(fs.statSync(source).nlink,2);
  assert.equal(called,false);
 }finally{fs.unlinkSync=origUnlink}
}));
