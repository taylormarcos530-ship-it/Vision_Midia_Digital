// OFFLINE LAB: child exits abruptly at each phase of a synthetic durable receipt.
// Never targets actual player, APIs, Supabase, production storage or customer data.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {buildChain}=require('./fixtures/commercial-evidence-hash-chain.cjs');
const {issueLabAnchor,ZERO}=require('./fixtures/commercial-evidence-external-anchor.cjs');
const {createDurableLabCustodian}=require('./fixtures/commercial-evidence-durable-lab.cjs');
const {reviewOrphan,releaseReviewedOrphan}
 =require('./fixtures/commercial-evidence-lock-review-lab.cjs');
const worker='tests/tools/commercial-evidence-crash-worker.cjs';
const load=name=>JSON.parse(fs.readFileSync('docs/implementation/'+name,'utf8'));
function fixture(){
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
function sandbox(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-custody-durable-'));
 try{return fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
const review={reviewerConfirmed:true,secondReviewerConfirmed:true,
 manualTicket:'LAB-TICKET-000001'};
const request=(receipt,head=ZERO,round=1)=>({
 receipt,expectedHead:head,requestId:'REQ-'+String(round).padStart(8,'0')
});
function exitAt(dir,phase,round){
 const child=spawnSync(process.execPath,[worker,dir,phase,String(round)],{
  cwd:process.cwd(),encoding:'utf8',timeout:20000});
 assert.equal(child.status,77,child.stderr||'Child should end after a fixture phase');
 assert.equal(child.stdout,'');
 assert.equal(child.stderr,'');
 assert.equal(fs.existsSync(path.join(dir,'writer.lock','owner.json')),true);
}
function release(dir,chain,pin){
 const opts={directory:dir,chain,expectedPinnedHead:pin};
 assert.equal(reviewOrphan(opts).status,'ORPHAN_REVIEW_REQUIRED');
 assert.equal(releaseReviewedOrphan({...opts,review:null}).status,
  'DUAL_REVIEW_REQUIRED');
 const cleaned=releaseReviewedOrphan({...opts,review});
 assert.equal(cleaned.status,'SIMULATED_MANUAL_LOCK_RELEASE');
 assert.equal(cleaned.canAutoUnlock,false);
}
test('process exit just after acquiring lock does not commit or remove lock',()=>sandbox(dir=>{
 const {chain,first}=fixture();exitAt(dir,'AFTER_LOCK',1);
 const writer=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(writer.read().count,0);
 assert.equal(writer.publish(request(first)).status,'LOCK_BUSY');
 assert.equal(fs.existsSync(path.join(dir,'ledger.json')),false);
 release(dir,chain,ZERO);
 assert.equal(writer.publish(request(first)).status,'COMMITTED');
 assert.equal(writer.read().count,1);
}));
test('exit after temporary fsync leaves orphan tmp but no committed receipt',()=>sandbox(dir=>{
 const {chain,first}=fixture();exitAt(dir,'AFTER_TEMP_SYNC',1);
 const pending=fs.readdirSync(dir).filter(x=>x.endsWith('.tmp'));
 assert.equal(pending.length,1);
 assert.equal(fs.statSync(path.join(dir,pending[0])).isFile(),true);
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,0);
 release(dir,chain,ZERO);
 assert.equal(createDurableLabCustodian(chain,{directory:dir})
  .publish(request(first)).status,'COMMITTED');
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,1);
 // Orphan temp is neither adopted nor deleted by lock recovery.
 assert.equal(fs.existsSync(path.join(dir,pending[0])),true);
}));
test('exit immediately after rename preserves committed receipt despite lost ACK',()=>sandbox(dir=>{
 const {chain,first}=fixture();exitAt(dir,'AFTER_RENAME',1);
 assert.equal(fs.readdirSync(dir).filter(x=>x.endsWith('.tmp')).length,0);
 const locked=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(locked.read().count,1);
 assert.equal(locked.publish(request(first)).status,'LOCK_BUSY');
 assert.equal(reviewOrphan({directory:dir,chain,expectedPinnedHead:ZERO})
  .status,'LEDGER_INVALID_OR_PIN_MISMATCH');
 release(dir,chain,first.receiptHash);
 assert.equal(createDurableLabCustodian(chain,{directory:dir})
  .publish(request(first)).status,'ALREADY_COMMITTED');
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,1);
}));
test('exit after directory fsync but before ACK stays idempotent',()=>sandbox(dir=>{
 const {chain,first}=fixture();exitAt(dir,'AFTER_DIR_SYNC',1);
 release(dir,chain,first.receiptHash);
 const reopened=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(reopened.publish(request(first)).status,'ALREADY_COMMITTED');
 assert.equal(reopened.read().head,first.receiptHash);
 assert.equal(reopened.canDeployToProduction,false);
}));
test('crash while rotating before temp write retains previous committed receipt',()=>sandbox(dir=>{
 const {chain,first,second}=fixture();
 createDurableLabCustodian(chain,{directory:dir}).publish(request(first));
 exitAt(dir,'AFTER_LOCK',2);
 const old=createDurableLabCustodian(chain,{directory:dir}).read();
 assert.equal(old.head,first.receiptHash);
 assert.equal(old.count,1);
 release(dir,chain,first.receiptHash);
 assert.equal(createDurableLabCustodian(chain,{directory:dir})
  .publish(request(second,first.receiptHash,2)).status,'COMMITTED');
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,2);
}));
test('crash during second receipt temp fsync never replaces first receipt',()=>sandbox(dir=>{
 const {chain,first,second}=fixture();
 createDurableLabCustodian(chain,{directory:dir}).publish(request(first));
 exitAt(dir,'AFTER_TEMP_SYNC',2);
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().head,first.receiptHash);
 release(dir,chain,first.receiptHash);
 assert.equal(createDurableLabCustodian(chain,{directory:dir})
  .publish(request(second,first.receiptHash,2)).status,'COMMITTED');
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,2);
}));
test('crash after second receipt rename retains both receipts, never duplicates',()=>sandbox(dir=>{
 const {chain,first,second}=fixture();
 createDurableLabCustodian(chain,{directory:dir}).publish(request(first));
 exitAt(dir,'AFTER_RENAME',2);
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().head,second.receiptHash);
 release(dir,chain,second.receiptHash);
 assert.equal(createDurableLabCustodian(chain,{directory:dir})
  .publish(request(second,first.receiptHash,2)).status,'ALREADY_COMMITTED');
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,2);
}));
test('crash after second receipt directory fsync allows exact request retry only',()=>sandbox(dir=>{
 const {chain,first,second}=fixture();
 createDurableLabCustodian(chain,{directory:dir}).publish(request(first));
 exitAt(dir,'AFTER_DIR_SYNC',2);
 release(dir,chain,second.receiptHash);
 const writer=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(writer.publish(request(second,first.receiptHash,2)).status,'ALREADY_COMMITTED');
 assert.equal(writer.publish(request(first,first.receiptHash,2)).status,'IDEMPOTENCY_CONFLICT');
 assert.equal(writer.read().count,2);
}));
test('a crash cannot silently erase an existing receipt even if writer retries with stale head',()=>sandbox(dir=>{
 const {chain,first,second}=fixture();
 createDurableLabCustodian(chain,{directory:dir}).publish(request(first));
 exitAt(dir,'AFTER_RENAME',2);
 release(dir,chain,second.receiptHash);
 const writer=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(writer.publish(request(first,ZERO,3)).status,'CONFLICT_STALE_HEAD');
 assert.equal(writer.read().count,2);
}));
test('corrupt ledger after child exit prevents review from clearing orphan lock',()=>sandbox(dir=>{
 const {chain,first}=fixture();exitAt(dir,'AFTER_RENAME',1);
 fs.writeFileSync(path.join(dir,'ledger.json'),'{');
 const opts={directory:dir,chain,expectedPinnedHead:first.receiptHash};
 assert.equal(reviewOrphan(opts).status,'LEDGER_INVALID_OR_PIN_MISMATCH');
 assert.equal(releaseReviewedOrphan({...opts,review}).status,'LOCK_NOT_CLEARED');
 assert.equal(fs.existsSync(path.join(dir,'writer.lock')),true);
}));
test('an orphan temp cannot be silently promoted when the committed ledger is corrupted',()=>sandbox(dir=>{
 const {chain,first}=fixture();exitAt(dir,'AFTER_TEMP_SYNC',1);
 fs.writeFileSync(path.join(dir,'ledger.json'),'{');
 const options={directory:dir,chain,expectedPinnedHead:ZERO};
 assert.equal(reviewOrphan(options).status,'LEDGER_INVALID_OR_PIN_MISMATCH');
 assert.equal(releaseReviewedOrphan({...options,review}).status,'LOCK_NOT_CLEARED');
 assert.equal(fs.readdirSync(dir).some(x=>x.endsWith('.tmp')),true);
 assert.throws(()=>createDurableLabCustodian(chain,{directory:dir}),SyntaxError);
}));
test('recovery requires independent matching head for both pending and committed cases',()=>sandbox(dir=>{
 const {chain,first}=fixture();exitAt(dir,'AFTER_TEMP_SYNC',1);
 const bad={directory:dir,chain,expectedPinnedHead:first.receiptHash};
 assert.equal(reviewOrphan(bad).status,'LEDGER_INVALID_OR_PIN_MISMATCH');
 assert.equal(releaseReviewedOrphan({...bad,review}).status,'LOCK_NOT_CLEARED');
 assert.equal(fs.existsSync(path.join(dir,'writer.lock')),true);
}));
test('worker refuses unsafe directory/unknown phase and never prints ledger bytes',()=>{
 const cases=[['/mnt/data','AFTER_LOCK','1'],
  [process.cwd(),'AFTER_LOCK','1'],
  [os.tmpdir(),'BAD_PHASE','1']];
 for(const args of cases){
  const x=spawnSync(process.execPath,[worker,...args],{
   cwd:process.cwd(),encoding:'utf8'});
  assert.equal(x.status,1);
  assert.equal(x.stdout,'');
  assert.match(x.stderr,/Synthetic crash worker refused/);
  assert.doesNotMatch(x.stderr,/Bearer |token=|source_storage_path|ledger-/);
 }
});
test('phase worker contains no real API/network or production code paths',()=>{
 const text=fs.readFileSync(worker,'utf8');
 assert.match(text,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(text,/\b(?:fetch|axios|https\.request|supabaseClient|netlify)\s*\(/);
 assert.match(text,/process\.exit\(77\)/);
});
