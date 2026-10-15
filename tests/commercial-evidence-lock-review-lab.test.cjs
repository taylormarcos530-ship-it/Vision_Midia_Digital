// OFFLINE LAB: simulate process death leaving a local synthetic OS lock.
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {buildChain}=require('./fixtures/commercial-evidence-hash-chain.cjs');
const {issueLabAnchor,ZERO}=require('./fixtures/commercial-evidence-external-anchor.cjs');
const {createDurableLabCustodian}=require('./fixtures/commercial-evidence-durable-lab.cjs');
const {stampSyntheticLock,reviewOrphan,releaseReviewedOrphan}
 =require('./fixtures/commercial-evidence-lock-review-lab.cjs');
const take=x=>JSON.parse(fs.readFileSync('docs/implementation/'+x,'utf8'));
const approvals={reviewerConfirmed:true,secondReviewerConfirmed:true,manualTicket:'LAB-TICKET-000001'};
function fixture(){
 const first=take('commercial-staging-evidence-template.json'),
 second=take('commercial-staging-evidence-lab-example.json');
 const chain=buildChain([
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:first},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:second},
  {sequence:3,recordedAt:'2026-10-15T12:15:00Z',form:structuredClone(second)}
 ]);
 const a=issueLabAnchor(chain,{recordCount:2,stampedAt:'2026-10-15T12:11:00Z'});
 const b=issueLabAnchor(chain,{previous:a,recordCount:3,stampedAt:'2026-10-15T12:16:00Z'});
 return {chain,a,b};
}
function sandbox(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-custody-durable-'));
 try{return fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
function terminatedOwner(directory){
 const script=[
  "const fs=require('node:fs'),path=require('node:path');",
  "const {stampSyntheticLock}=require('./tests/fixtures/commercial-evidence-lock-review-lab.cjs');",
  "fs.mkdirSync(path.join(process.argv[1],'writer.lock'));",
  "stampSyntheticLock({directory:process.argv[1]});",
  "process.exit(87);"
 ].join('\n');
 const child=spawnSync(process.execPath,['-e',script,directory],
  {cwd:process.cwd(),encoding:'utf8'});
 assert.equal(child.status,87,child.stderr);
 assert.equal(fs.existsSync(path.join(directory,'writer.lock','owner.json')),true);
}
const options=(dir,chain,pin=ZERO)=>({directory:dir,chain,expectedPinnedHead:pin});
test('without a lock there is nothing to recover',()=>sandbox(dir=>{
 const {chain}=fixture();
 assert.equal(reviewOrphan(options(dir,chain)).status,'NO_LOCK');
 assert.equal(releaseReviewedOrphan({...options(dir,chain),review:approvals}).status,
  'LOCK_NOT_CLEARED');
}));
test('unmarked stale lock stays blocked: unknown ownership requires investigation',()=>sandbox(dir=>{
 const {chain,a}=fixture();fs.mkdirSync(path.join(dir,'writer.lock'));
 assert.equal(reviewOrphan(options(dir,chain)).status,'OWNER_UNKNOWN');
 assert.equal(releaseReviewedOrphan({...options(dir,chain),review:approvals}).status,
  'LOCK_NOT_CLEARED');
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).publish({
  receipt:a,expectedHead:ZERO,requestId:'REQ-00000001'}).status,'LOCK_BUSY');
}));
test('live holder PID is NEVER released, even when review flags are all true',()=>sandbox(dir=>{
 const {chain}=fixture();fs.mkdirSync(path.join(dir,'writer.lock'));
 assert.equal(stampSyntheticLock({directory:dir}).status,'STAMPED_SYNTHETIC_OWNER');
 assert.equal(reviewOrphan(options(dir,chain)).status,'OWNER_STILL_RUNNING');
 assert.equal(releaseReviewedOrphan({...options(dir,chain),review:approvals}).status,
  'LOCK_NOT_CLEARED');
 assert.equal(fs.existsSync(path.join(dir,'writer.lock','owner.json')),true);
}));
test('real exited child leaves an orphaned test lock but inspection never removes it',()=>sandbox(dir=>{
 const {chain}=fixture();terminatedOwner(dir);
 const info=reviewOrphan(options(dir,chain));
 assert.equal(info.status,'ORPHAN_REVIEW_REQUIRED');
 assert.equal(info.canAutoUnlock,false);
 assert.equal(info.canConnectStaging,false);
 assert.equal(info.canDeployToProduction,false);
 assert.equal(fs.existsSync(path.join(dir,'writer.lock')),true);
}));
test('orphaned lock is not cleared without both explicit synthetic reviewers',()=>sandbox(dir=>{
 const {chain}=fixture();terminatedOwner(dir);
 for(const review of [
  null,{}, {reviewerConfirmed:true,secondReviewerConfirmed:false,
   manualTicket:'LAB-TICKET-000001'},
  {reviewerConfirmed:false,secondReviewerConfirmed:true,
   manualTicket:'LAB-TICKET-000001'},
  {reviewerConfirmed:true,secondReviewerConfirmed:true,manualTicket:'INVALID'},
  {...approvals,productionAuthorized:true}
 ]){
  assert.equal(releaseReviewedOrphan({...options(dir,chain),review}).status,
   'DUAL_REVIEW_REQUIRED');
 }
 assert.equal(fs.existsSync(path.join(dir,'writer.lock')),true);
}));
test('stale ledger pin prevents clearing an orphan, even with two reviewers',()=>sandbox(dir=>{
 const {chain,a,b}=fixture();
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).publish({
  receipt:a,expectedHead:ZERO,requestId:'REQ-00000001'}).status,'COMMITTED');
 terminatedOwner(dir);
 const result=releaseReviewedOrphan({
  ...options(dir,chain,b.receiptHash),review:approvals});
 assert.equal(result.status,'LOCK_NOT_CLEARED');
 assert.equal(result.reason,'LEDGER_INVALID_OR_PIN_MISMATCH');
 assert.equal(fs.existsSync(path.join(dir,'writer.lock')),true);
}));
test('after genuine child exit and matching pinned ledger, explicit lab review releases lock',()=>sandbox(dir=>{
 const {chain,a}=fixture();terminatedOwner(dir);
 const before=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(before.publish({
  receipt:a,expectedHead:ZERO,requestId:'REQ-00000001'}).status,'LOCK_BUSY');
 const release=releaseReviewedOrphan({...options(dir,chain),review:approvals});
 assert.equal(release.status,'SIMULATED_MANUAL_LOCK_RELEASE');
 assert.equal(release.canAutoUnlock,false);
 assert.equal(fs.existsSync(path.join(dir,'writer.lock')),false);
 const resumed=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(resumed.publish({
  receipt:a,expectedHead:ZERO,requestId:'REQ-00000001'}).status,'COMMITTED');
 assert.equal(createDurableLabCustodian(chain,{directory:dir}).read().count,1);
}));
test('ledger already committed before crash survives manual unlock with no duplicate',()=>sandbox(dir=>{
 const {chain,a}=fixture(),db=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(db.publish({
  receipt:a,expectedHead:ZERO,requestId:'REQ-00000001'}).status,'COMMITTED');
 terminatedOwner(dir);
 assert.equal(reviewOrphan(options(dir,chain,a.receiptHash)).receipts,1);
 assert.equal(releaseReviewedOrphan({
  ...options(dir,chain,a.receiptHash),review:approvals
 }).status,'SIMULATED_MANUAL_LOCK_RELEASE');
 const restarted=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(restarted.publish({
  receipt:a,expectedHead:ZERO,requestId:'REQ-00000001'}).status,'ALREADY_COMMITTED');
 assert.equal(restarted.read().count,1);
}));
test('corrupt ledger must never be fixed by silently deleting lock',()=>sandbox(dir=>{
 const {chain,a}=fixture(),db=createDurableLabCustodian(chain,{directory:dir});
 db.publish({receipt:a,expectedHead:ZERO,requestId:'REQ-00000001'});
 terminatedOwner(dir);
 fs.writeFileSync(path.join(dir,'ledger.json'),'{');
 assert.equal(reviewOrphan(options(dir,chain,a.receiptHash)).status,
  'LEDGER_INVALID_OR_PIN_MISMATCH');
 assert.equal(releaseReviewedOrphan({
  ...options(dir,chain,a.receiptHash),review:approvals
 }).status,'LOCK_NOT_CLEARED');
 assert.equal(fs.existsSync(path.join(dir,'writer.lock')),true);
}));
test('tampered or unreadable marker refuses recovery',()=>sandbox(dir=>{
 const {chain}=fixture();terminatedOwner(dir);
 const file=path.join(dir,'writer.lock','owner.json');
 const contents=JSON.parse(fs.readFileSync(file,'utf8'));
 contents.nonce='0'.repeat(32);
 fs.writeFileSync(file,JSON.stringify(contents));
 assert.equal(reviewOrphan(options(dir,chain)).status,'OWNER_UNKNOWN');
 assert.equal(releaseReviewedOrphan({
  ...options(dir,chain),review:approvals
 }).status,'LOCK_NOT_CLEARED');
}));
test('surprise file inside lock blocks recovery without deleting any marker',()=>sandbox(dir=>{
 const {chain}=fixture();terminatedOwner(dir);
 fs.writeFileSync(path.join(dir,'writer.lock','unexpected.txt'),'local');
 assert.equal(releaseReviewedOrphan({
  ...options(dir,chain),review:approvals
 }).status,'LOCK_NOT_CLEARED');
 assert.equal(fs.existsSync(path.join(dir,'writer.lock','owner.json')),true);
}));
test('symbolic link disguised as writer.lock is rejected as unsafe',()=>sandbox(dir=>{
 const {chain}=fixture();const other=path.join(dir,'foreign');
 fs.mkdirSync(other);fs.symlinkSync(other,path.join(dir,'writer.lock'));
 assert.equal(reviewOrphan(options(dir,chain)).status,'UNSAFE_LOCK');
 assert.equal(releaseReviewedOrphan({
  ...options(dir,chain),review:approvals
 }).status,'LOCK_NOT_CLEARED');
}));
test('only the controlled OS temp namespace is permitted',()=>{
 const {chain}=fixture();
 for(const directory of [process.cwd(),'/mnt/data',path.join(os.tmpdir(),'customer')])
  assert.throws(()=>reviewOrphan(options(directory,chain)),/Only synthetic test folder/);
});
test('missing or invalid independent head cannot authorize manual unlock',()=>sandbox(dir=>{
 const {chain}=fixture();terminatedOwner(dir);
 assert.throws(()=>reviewOrphan(options(dir,chain,'not-a-head')),
  /Expected a separate 256-bit head/);
 assert.equal(fs.existsSync(path.join(dir,'writer.lock')),true);
}));
test('a marker can be stamped only once, on an otherwise empty real lock',()=>sandbox(dir=>{
 fs.mkdirSync(path.join(dir,'writer.lock'));
 assert.equal(stampSyntheticLock({directory:dir}).status,'STAMPED_SYNTHETIC_OWNER');
 assert.throws(()=>stampSyntheticLock({directory:dir}),/new empty synthetic lock/);
}));
test('unapproved lock removal remains impossible through the durable publish API',()=>sandbox(dir=>{
 const {chain,a}=fixture();terminatedOwner(dir);
 const db=createDurableLabCustodian(chain,{directory:dir});
 assert.equal(db.publish({receipt:a,expectedHead:ZERO,requestId:'REQ-00000001'}).status,
  'LOCK_BUSY');
 assert.equal(fs.existsSync(path.join(dir,'writer.lock')),true);
}));
test('all recovery actions remain local and cannot authorize remote releases',()=>{
 const src=fs.readFileSync('tests/fixtures/commercial-evidence-lock-review-lab.cjs','utf8');
 assert.match(src,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(src,/\b(?:fetch|axios|https\.request|supabaseClient|execFileSync)\b/);
 const sql=fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8');
 assert.doesNotMatch(sql,/commercial-evidence-lock-review-lab/);
});
