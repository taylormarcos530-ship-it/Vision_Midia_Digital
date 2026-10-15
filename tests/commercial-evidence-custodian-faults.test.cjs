// OFFLINE LAB: role boundaries, outages, conflicts, idempotence, stale backups.
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {buildChain}=require('./fixtures/commercial-evidence-hash-chain.cjs');
const {issueLabAnchor,ZERO}=require('./fixtures/commercial-evidence-external-anchor.cjs');
const {createLabCustodian}=require('./fixtures/commercial-evidence-custodian-faults.cjs');
const load=name=>JSON.parse(fs.readFileSync('docs/implementation/'+name,'utf8'));
function sample(){
 const a=load('commercial-staging-evidence-template.json'),
 b=load('commercial-staging-evidence-lab-example.json');
 const chain=buildChain([
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:a},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:b},
  {sequence:3,recordedAt:'2026-10-15T12:15:00Z',form:structuredClone(b)}
 ]);
 const first=issueLabAnchor(chain,{recordCount:2,stampedAt:'2026-10-15T12:11:00Z'});
 const next=issueLabAnchor(chain,{previous:first,recordCount:3,stampedAt:'2026-10-15T12:16:00Z'});
 return {chain,first,next,store:createLabCustodian(chain)};
}
const attempt=(receipt,expectedHead=ZERO,requestId='REQ-00000001',role='WRITER')=>
 ({receipt,expectedHead,requestId,role});
const status=x=>x.status;
test('initial custodian has zero records; no automatic staging capability',()=>{
 const {store}=sample();
 assert.deepEqual(store.read({role:'REVIEWER'}),{status:'OK',count:0,head:ZERO});
 assert.equal(store.canConnectStaging,false);
 assert.equal(store.canDeployToProduction,false);
});
test('independent reviewer cannot publish, outsider cannot read, operator cannot read',()=>{
 const {store,first}=sample();
 assert.equal(status(store.publish(attempt(first,ZERO,'REQ-00000001','REVIEWER'))),'DENIED');
 assert.equal(status(store.read({role:'OUTSIDER'})),'DENIED');
 assert.equal(status(store.read({role:'OPERATOR'})),'DENIED');
 assert.equal(status(store.snapshot({role:'OUTSIDER'})),'DENIED');
 assert.equal(status(store.audit({role:'OUTSIDER'})),'DENIED');
 assert.equal(store.read({role:'REVIEWER'}).count,0);
});
test('only operator can toggle fixture outage; unauthorized cannot mask availability',()=>{
 const {store}=sample();
 assert.equal(status(store.availability({role:'WRITER',online:false})),'DENIED');
 assert.equal(status(store.availability({role:'OPERATOR',online:false})),'OFFLINE');
 assert.equal(status(store.availability({role:'OPERATOR',online:true})),'ONLINE');
});
test('network outage rejects reads and writes without appending a receipt',()=>{
 const {store,first}=sample();
 store.availability({role:'OPERATOR',online:false});
 assert.equal(status(store.read({role:'REVIEWER'})),'UNAVAILABLE');
 assert.equal(status(store.publish(attempt(first))),'UNAVAILABLE');
 assert.equal(status(store.snapshot({role:'REVIEWER'})),'UNAVAILABLE');
 store.availability({role:'OPERATOR',online:true});
 assert.equal(store.read({role:'REVIEWER'}).count,0);
});
test('successful write then lost acknowledgement is idempotent on same request ID',()=>{
 const {store,first}=sample();
 assert.equal(status(store.publish(attempt(first))),'COMMITTED');
 assert.equal(status(store.publish(attempt(first))),'ALREADY_COMMITTED');
 assert.equal(store.read({role:'REVIEWER'}).count,1);
});
test('reuse of same opaque request ID with different receipt is an explicit conflict',()=>{
 const {store,first,next}=sample();
 assert.equal(status(store.publish(attempt(first))),'COMMITTED');
 const conflict=store.publish(attempt(next,first.receiptHash,'REQ-00000001'));
 assert.equal(conflict.status,'IDEMPOTENCY_CONFLICT');
 assert.equal(store.read({role:'REVIEWER'}).count,1);
});
test('two writers using same expected head cannot both commit',()=>{
 const {store,first,next}=sample();
 const sameHead=ZERO;
 const firstAttempt=store.publish(attempt(first,sameHead,'REQ-00000001'));
 const secondAttempt=store.publish(attempt(next,sameHead,'REQ-00000002'));
 assert.equal(firstAttempt.status,'COMMITTED');
 assert.equal(secondAttempt.status,'CONFLICT_STALE_HEAD');
 assert.equal(store.read({role:'REVIEWER'}).count,1);
});
test('new receipt can rotate only after reading the latest committed head',()=>{
 const {store,first,next}=sample();
 store.publish(attempt(first));
 const updated=store.read({role:'WRITER'});
 assert.equal(updated.head,first.receiptHash);
 assert.equal(status(store.publish(attempt(next,updated.head,'REQ-00000002'))),'COMMITTED');
 assert.equal(store.read({role:'REVIEWER'}).count,2);
 assert.equal(store.read({role:'REVIEWER'}).head,next.receiptHash);
});
test('a forged receipt and skipped rotation cannot enter custody',()=>{
 const {store,first,next}=sample();
 assert.equal(status(store.publish(attempt(next))),'INVALID_RECEIPT');
 const fake={...first,receiptHash:'a'.repeat(64)};
 assert.equal(status(store.publish(attempt(fake,ZERO,'REQ-00000003'))),'INVALID_RECEIPT');
 assert.equal(store.read({role:'REVIEWER'}).count,0);
});
test('outage between first and second rotations prevents silent success',()=>{
 const {store,first,next}=sample();
 assert.equal(status(store.publish(attempt(first))),'COMMITTED');
 store.availability({role:'OPERATOR',online:false});
 assert.equal(status(store.publish(attempt(next,first.receiptHash,'REQ-00000002'))),'UNAVAILABLE');
 store.availability({role:'OPERATOR',online:true});
 assert.equal(store.read({role:'REVIEWER'}).count,1);
 assert.equal(status(store.publish(attempt(next,first.receiptHash,'REQ-00000002'))),'COMMITTED');
});
test('backup snapshot is detached: caller mutation cannot corrupt live custody',()=>{
 const {store,first}=sample();
 store.publish(attempt(first));
 const result=store.snapshot({role:'REVIEWER'});
 assert.equal(result.status,'OK');
 result.snapshot.receipts[0].headHash='c'.repeat(64);
 assert.equal(store.read({role:'REVIEWER'}).head,first.receiptHash);
});
test('known-good current backup is ONLY eligible for manual independent review',()=>{
 const {store,first}=sample();
 store.publish(attempt(first));
 const backup=store.snapshot({role:'REVIEWER'}).snapshot;
 const result=store.inspectBackup({role:'REVIEWER',backup,
  independentlyHeldDigest:first.receiptHash});
 assert.equal(result.status,'MANUAL_REVIEW_ONLY');
 assert.equal(result.canRestoreAutomatically,false);
 assert.equal(result.externalCustodyVerified,false);
});
test('stale backup cannot overwrite second committed receipt',()=>{
 const {store,first,next}=sample();
 store.publish(attempt(first));
 const old=store.snapshot({role:'REVIEWER'}).snapshot;
 store.publish(attempt(next,first.receiptHash,'REQ-00000002'));
 const r=store.inspectBackup({role:'REVIEWER',backup:old,
  independentlyHeldDigest:next.receiptHash});
 assert.equal(r.status,'INDEPENDENT_HEAD_MISMATCH');
 assert.equal(store.read({role:'REVIEWER'}).count,2);
});
test('backup from another ledger is rejected even when digest shape is valid',()=>{
 const {store,first}=sample();
 store.publish(attempt(first));
 const copied=store.snapshot({role:'REVIEWER'}).snapshot;
 copied.receipts[0].headHash='d'.repeat(64);
 assert.equal(status(store.inspectBackup({role:'REVIEWER',backup:copied,
  independentlyHeldDigest:first.receiptHash})),'CORRUPTED_BACKUP_REJECTED');
});
test('false external pin rejects otherwise valid current backup',()=>{
 const {store,first}=sample();
 store.publish(attempt(first));
 const backup=store.snapshot({role:'REVIEWER'}).snapshot;
 assert.equal(status(store.inspectBackup({role:'REVIEWER',backup,
  independentlyHeldDigest:'e'.repeat(64)})),'INDEPENDENT_HEAD_MISMATCH');
});
test('offline recovery cannot be treated as a successful backup match',()=>{
 const {store,first}=sample();
 store.publish(attempt(first));
 const backup=store.snapshot({role:'REVIEWER'}).snapshot;
 store.availability({role:'OPERATOR',online:false});
 assert.equal(status(store.inspectBackup({role:'REVIEWER',backup,
  independentlyHeldDigest:first.receiptHash})),'UNAVAILABLE');
});
test('empty backup and malformed backup fields fail closed',()=>{
 const {store,first}=sample();
 const b=store.snapshot({role:'REVIEWER'}).snapshot;
 assert.equal(status(store.inspectBackup({role:'REVIEWER',backup:b,
  independentlyHeldDigest:first.receiptHash})),'STALE_BACKUP_REJECTED');
 assert.equal(status(store.inspectBackup({role:'REVIEWER',backup:{...b,url:'test'},
  independentlyHeldDigest:first.receiptHash})),'INVALID_BACKUP');
});
test('unknown role cannot attempt backup recovery or force publication',()=>{
 const {store,first}=sample();
 assert.equal(status(store.inspectBackup({role:'OUTSIDER',backup:{},
  independentlyHeldDigest:first.receiptHash})),'DENIED');
 assert.equal(status(store.publish(attempt(first,ZERO,'REQ-00000001','OUTSIDER'))),'DENIED');
});
test('audit records have no digest, token, request ID, object path or receipt body',()=>{
 const {store,first,next}=sample();
 store.publish(attempt(first));
 store.publish(attempt(next,ZERO,'REQ-00000002'));
 store.availability({role:'OPERATOR',online:false});
 store.availability({role:'OPERATOR',online:true});
 const logs=store.audit({role:'REVIEWER'});
 assert.equal(logs.status,'OK');
 const json=JSON.stringify(logs.events);
 assert.doesNotMatch(json,/receiptHash|headHash|previousAnchorHash|EV-|REQ-|Bearer|token|[0-9a-f]{64}/);
 assert.match(json,/COMMITTED/);
 assert.match(json,/CONFLICT_STALE_HEAD/);
});
test('attempts to add unapproved publication fields or malicious request ID are refused',()=>{
 const {store,first}=sample();
 assert.throws(()=>store.publish({...attempt(first),signedUrl:'synthetic'}),/Invalid publication/);
 assert.throws(()=>store.publish(attempt(first,ZERO,'REQ-../LIVE')),/Invalid CAS/);
 assert.equal(store.read({role:'REVIEWER'}).count,0);
});
test('unavailable writer retry cannot impersonate acknowledgement after recovery',()=>{
 const {store,first}=sample();
 store.availability({role:'OPERATOR',online:false});
 assert.equal(status(store.publish(attempt(first))),'UNAVAILABLE');
 store.availability({role:'OPERATOR',online:true});
 assert.equal(status(store.publish(attempt(first))),'COMMITTED');
 assert.equal(status(store.publish(attempt(first))),'ALREADY_COMMITTED');
});
test('no code path grants permission for staging or deployment',()=>{
 const {store}=sample();
 const src=fs.readFileSync('tests/fixtures/commercial-evidence-custodian-faults.cjs','utf8');
 assert.match(src,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(src,/\b(?:fetch|axios|writeFileSync|https\.request|execFileSync)\s*\(/);
 assert.equal(store.canConnectStaging,false);
 assert.equal(store.canDeployToProduction,false);
});
