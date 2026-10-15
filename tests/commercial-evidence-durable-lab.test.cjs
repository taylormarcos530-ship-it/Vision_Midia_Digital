// OFFLINE LAB: durable synthetic receipts, crash phases, no production identity.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {buildChain}=require('./fixtures/commercial-evidence-hash-chain.cjs');
const {issueLabAnchor,ZERO}=require('./fixtures/commercial-evidence-external-anchor.cjs');
const {createDurableLabCustodian}=require('./fixtures/commercial-evidence-durable-lab.cjs');
const load=x=>JSON.parse(fs.readFileSync('docs/implementation/'+x,'utf8'));
function data(){
 const first=load('commercial-staging-evidence-template.json');
 const second=load('commercial-staging-evidence-lab-example.json');
 const chain=buildChain([
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:first},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:second},
  {sequence:3,recordedAt:'2026-10-15T12:15:00Z',form:structuredClone(second)}
 ]);
 const a=issueLabAnchor(chain,{recordCount:2,stampedAt:'2026-10-15T12:11:00Z'});
 const b=issueLabAnchor(chain,{previous:a,recordCount:3,stampedAt:'2026-10-15T12:16:00Z'});
 return {chain,a,b};
}
function isolated(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-custody-durable-'));
 try{return fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
const input=(receipt,expectedHead=ZERO,requestId='REQ-00000001',fault=null)=>
 ({receipt,expectedHead,requestId,fault});
const store=(chain,directory,expectedPinnedHead=null)=>
 createDurableLabCustodian(chain,{directory,expectedPinnedHead});
test('new ledger has ZERO head and no operational permissions',()=>isolated(dir=>{
 const {chain}=data(),x=store(chain,dir);
 assert.deepEqual(x.read(),{status:'OK',count:0,head:ZERO});
 assert.equal(fs.existsSync(path.join(dir,'ledger.json')),false);
 assert.equal(x.canConnectStaging,false);
 assert.equal(x.canDeployToProduction,false);
}));
test('commit survives new instance and idempotency also survives',()=>isolated(dir=>{
 const {chain,a}=data();
 assert.equal(store(chain,dir).publish(input(a)).status,'COMMITTED');
 const reopened=store(chain,dir);
 assert.deepEqual(reopened.read(),{status:'OK',count:1,head:a.receiptHash});
 assert.equal(reopened.publish(input(a)).status,'ALREADY_COMMITTED');
}));
test('committed data is recovered in a fresh independent Node process',()=>isolated(dir=>{
 const {chain,a}=data();store(chain,dir).publish(input(a));
 const script=[
 "const fs=require('node:fs');",
 "const {buildChain}=require('./tests/fixtures/commercial-evidence-hash-chain.cjs');",
 "const {createDurableLabCustodian}=require('./tests/fixtures/commercial-evidence-durable-lab.cjs');",
 "const load=x=>JSON.parse(fs.readFileSync('docs/implementation/'+x,'utf8'));",
 "const a=load('commercial-staging-evidence-template.json'),b=load('commercial-staging-evidence-lab-example.json');",
 "const chain=buildChain([{sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:a},",
 "{sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:b},",
 "{sequence:3,recordedAt:'2026-10-15T12:15:00Z',form:structuredClone(b)}]);",
 "const result=createDurableLabCustodian(chain,{directory:process.argv[1]}).read();",
 "process.stdout.write(JSON.stringify({count:result.count,validHead:result.head===process.argv[2]}));"
 ].join('\n');
 const proc=spawnSync(process.execPath,['-e',script,dir,a.receiptHash],
  {cwd:process.cwd(),encoding:'utf8'});
 assert.equal(proc.status,0,proc.stderr);
 assert.deepEqual(JSON.parse(proc.stdout),{count:1,validHead:true});
}));
test('second anchor persists after reloading the first',()=>isolated(dir=>{
 const {chain,a,b}=data();store(chain,dir).publish(input(a));
 assert.equal(store(chain,dir).publish(input(b,a.receiptHash,'REQ-00000002')).status,'COMMITTED');
 assert.equal(store(chain,dir).read().count,2);
}));
test('lost confirmation after rename persists both receipt and idempotency key',()=>isolated(dir=>{
 const {chain,a}=data();
 assert.equal(store(chain,dir).publish(input(a,ZERO,'REQ-00000001',
  'AFTER_RENAME_BEFORE_ACK')).status,'ACK_LOST_AFTER_COMMIT');
 const reopened=store(chain,dir);
 assert.equal(reopened.read().head,a.receiptHash);
 assert.equal(reopened.publish(input(a)).status,'ALREADY_COMMITTED');
 assert.equal(reopened.read().count,1);
}));
test('fault BEFORE_TEMP_WRITE is non-committing and safe to retry',()=>isolated(dir=>{
 const {chain,a}=data();
 assert.equal(store(chain,dir).publish(input(a,ZERO,'REQ-00000001',
  'BEFORE_TEMP_WRITE')).status,'SIMULATED_UNAVAILABLE');
 assert.equal(store(chain,dir).read().count,0);
 assert.equal(store(chain,dir).publish(input(a)).status,'COMMITTED');
}));
test('fault AFTER_TEMP_SYNC leaves no committed bytes or false ACK',()=>isolated(dir=>{
 const {chain,a}=data();
 assert.equal(store(chain,dir).publish(input(a,ZERO,'REQ-00000001',
  'AFTER_TEMP_SYNC')).status,'SIMULATED_UNAVAILABLE');
 assert.equal(store(chain,dir).read().count,0);
 assert.equal(store(chain,dir).publish(input(a)).status,'COMMITTED');
 assert.deepEqual(fs.readdirSync(dir).sort(),['ledger.json']);
}));
test('stale expected head and conflicting request identity survive reopen',()=>isolated(dir=>{
 const {chain,a,b}=data();store(chain,dir).publish(input(a));
 const reopened=store(chain,dir);
 assert.equal(reopened.publish(input(b,ZERO,'REQ-00000002')).status,'CONFLICT_STALE_HEAD');
 assert.equal(reopened.publish(input(b,ZERO,'REQ-00000001')).status,'IDEMPOTENCY_CONFLICT');
 assert.equal(reopened.read().count,1);
}));
test('OS directory lock prevents a second cooperating writer',()=>isolated(dir=>{
 const {chain,a}=data();fs.mkdirSync(path.join(dir,'writer.lock'));
 assert.equal(store(chain,dir).publish(input(a)).status,'LOCK_BUSY');
 assert.equal(store(chain,dir).read().count,0);
 assert.equal(fs.existsSync(path.join(dir,'writer.lock')),true);
 fs.rmdirSync(path.join(dir,'writer.lock'));
 assert.equal(store(chain,dir).publish(input(a)).status,'COMMITTED');
}));
test('checksum detects modification of a syntactically valid stored receipt',()=>isolated(dir=>{
 const {chain,a}=data();store(chain,dir).publish(input(a));
 const dest=path.join(dir,'ledger.json'),obj=JSON.parse(fs.readFileSync(dest,'utf8'));
 obj.receipts[0].recordCount=1;
 fs.writeFileSync(dest,JSON.stringify(obj));
 assert.throws(()=>store(chain,dir),/PERSISTED_STATE_CHECKSUM_MISMATCH/);
}));
test('truncated or malformed persisted JSON fails closed rather than resets',()=>isolated(dir=>{
 const {chain,a}=data();store(chain,dir).publish(input(a));
 fs.writeFileSync(path.join(dir,'ledger.json'),'{');
 assert.throws(()=>store(chain,dir),SyntaxError);
}));
test('symbolic and hard links to persisted ledger are forbidden',()=>isolated(dir=>{
 const {chain}=data(),loc=path.join(dir,'ledger.json');
 fs.writeFileSync(path.join(dir,'other.json'),'{}');
 fs.symlinkSync(path.join(dir,'other.json'),loc);
 assert.throws(()=>store(chain,dir),/PERSISTED_STATE_UNSAFE/);
 fs.unlinkSync(loc);
 fs.linkSync(path.join(dir,'other.json'),loc);
 assert.throws(()=>store(chain,dir),/PERSISTED_STATE_UNSAFE/);
}));
test('rollback of valid old ledger requires independently preserved later head',()=>isolated(dir=>{
 const {chain,a,b}=data(),db=store(chain,dir);
 db.publish(input(a));
 const old=fs.readFileSync(path.join(dir,'ledger.json'));
 db.publish(input(b,a.receiptHash,'REQ-00000002'));
 fs.writeFileSync(path.join(dir,'ledger.json'),old);
 assert.equal(store(chain,dir).read().count,1);
 assert.throws(()=>store(chain,dir,b.receiptHash),/EXTERNALLY_PINNED_HEAD_MISMATCH/);
}));
test('unsupported directory paths cannot be opened for persistence',()=>{
 const {chain}=data();
 for(const dir of [process.cwd(),'/mnt/data',path.join(os.tmpdir(),'elsewhere')])
  assert.throws(()=>store(chain,dir),/Only synthetic temporary directories/);
});
test('forged skipped receipt is never written to disk',()=>isolated(dir=>{
 const {chain,b}=data();
 assert.equal(store(chain,dir).publish(input(b)).status,'INVALID_RECEIPT');
 assert.equal(fs.existsSync(path.join(dir,'ledger.json')),false);
}));
test('the durability fixture has no remote, product or deployment actions',()=>{
 const src=fs.readFileSync('tests/fixtures/commercial-evidence-durable-lab.cjs','utf8');
 assert.match(src,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(src,/\b(?:fetch|axios|https\.request|supabaseClient|child_process)\b/);
});
