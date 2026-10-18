// OFFLINE LAB ONLY: executable read-only forensic checks. No external fixture imports.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {inspectInterruptedQuarantine}=require('./fixtures/commercial-evidence-quarantine-reconciliation-lab.cjs');
const name='ledger-123-1770000000000.tmp';
const hash=items=>createHash('sha256').update('VISION-ORPHAN-TEMP-INVENTORY-V1\0')
 .update(JSON.stringify(items)).digest('hex');
function folder(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-custody-durable-'));
 try{return fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
const source=dir=>path.join(dir,name);
function fingerprint(file){
 const st=fs.statSync(file);const bytes=fs.readFileSync(file);
 return hash([st.dev,st.ino,st.size,st.mtimeMs,
  createHash('sha256').update(bytes).digest('hex')]);
}
function prepare(dir){
 fs.writeFileSync(source(dir),'synthetic data - not a receipt');
 return fingerprint(source(dir));
}
function destination(dir,fp){return path.join(dir,'quarantine',name+'.'+fp.slice(0,16)+'.quarantined')}
const call=(dir,fp,overrides={})=>inspectInterruptedQuarantine({directory:dir,name,
 expectedFingerprint:fp,...overrides});
const safe=result=>{
 assert.equal(result.readOnly,true);
 assert.equal(result.ledgerVerified,false);
 assert.equal(result.canAutoResolve,false);
 assert.equal(result.canConnectStaging,false);
 assert.equal(result.canDeployToProduction,false);
 assert.equal(Object.hasOwn(result,'directory'),false);
 assert.equal(Object.hasOwn(result,'expectedFingerprint'),false);
};

test('source only is still awaiting manual review and creates no folder',()=>folder(dir=>{
 const fp=prepare(dir),before=fs.readdirSync(dir);
 const r=call(dir,fp);safe(r);
 assert.equal(r.status,'SOURCE_ONLY_REVIEW_REQUIRED');
 assert.deepEqual(fs.readdirSync(dir),before);
}));
test('no source or destination is reported without writing files',()=>folder(dir=>{
 const r=call(dir,'0'.repeat(64));safe(r);
 assert.equal(r.status,'NO_MATCHING_FILES');assert.deepEqual(fs.readdirSync(dir),[]);
}));
test('interrupted local hardlink pair is detected but neither name is removed',()=>folder(dir=>{
 const fp=prepare(dir);fs.mkdirSync(path.join(dir,'quarantine'));
 fs.linkSync(source(dir),destination(dir,fp));
 const r=call(dir,fp);safe(r);
 assert.equal(r.status,'PAIRED_HARDLINK_REVIEW_REQUIRED');
 assert.equal(fs.statSync(source(dir)).nlink,2);
 assert.deepEqual(fs.readFileSync(source(dir)),fs.readFileSync(destination(dir,fp)));
}));
test('destination only remains present without automatic restoration',()=>folder(dir=>{
 const fp=prepare(dir);fs.mkdirSync(path.join(dir,'quarantine'));
 fs.linkSync(source(dir),destination(dir,fp));fs.unlinkSync(source(dir));
 const r=call(dir,fp);safe(r);
 assert.equal(r.status,'DESTINATION_ONLY_REVIEW_REQUIRED');
 assert.equal(fs.existsSync(source(dir)),false);
 assert.equal(fs.existsSync(destination(dir,fp)),true);
}));
test('different source and destination inodes are not considered a pair',()=>folder(dir=>{
 const fp=prepare(dir);fs.mkdirSync(path.join(dir,'quarantine'));
 fs.copyFileSync(source(dir),destination(dir,fp));
 // Identical bytes do not imply identical inode; source timestamp may differ.
 const r=call(dir,fp);safe(r);
 assert.equal(r.status,'CONFLICTING_FILES_REVIEW_REQUIRED');
 assert.equal(fs.existsSync(source(dir)),true);
 assert.equal(fs.existsSync(destination(dir,fp)),true);
}));
test('tampered source after fingerprint cannot be treated as original',()=>folder(dir=>{
 const fp=prepare(dir);fs.appendFileSync(source(dir),'altered');
 assert.equal(call(dir,fp).status,'SELECTION_CHANGED_REVIEW_REQUIRED');
}));
test('tampered hardlink contents are never paired under stale fingerprint',()=>folder(dir=>{
 const fp=prepare(dir);fs.mkdirSync(path.join(dir,'quarantine'));
 fs.linkSync(source(dir),destination(dir,fp));fs.appendFileSync(source(dir),'altered');
 assert.equal(call(dir,fp).status,'SELECTION_CHANGED_REVIEW_REQUIRED');
}));
test('symlink source is reported unsafe without following target',()=>folder(dir=>{
 const fp='0'.repeat(64),external=path.join(dir,'external');
 fs.writeFileSync(external,'preserve');fs.symlinkSync(external,source(dir));
 assert.equal(call(dir,fp).status,'UNSAFE_FILE_REVIEW_REQUIRED');
 assert.equal(fs.readFileSync(external,'utf8'),'preserve');
}));
test('dangling symlink candidate is still reported unsafe',()=>folder(dir=>{
 fs.symlinkSync(path.join(dir,'missing'),source(dir));
 assert.equal(call(dir,'0'.repeat(64)).status,'UNSAFE_FILE_REVIEW_REQUIRED');
}));
test('symlink quarantine directory cannot redirect inspection to external folder',()=>folder(dir=>{
 const fp=prepare(dir),external=fs.mkdtempSync(path.join(os.tmpdir(),'vision-recon-other-'));
 try{
  fs.symlinkSync(external,path.join(dir,'quarantine'));
  assert.equal(call(dir,fp).status,'UNSAFE_QUARANTINE_DIRECTORY');
  assert.deepEqual(fs.readdirSync(external),[]);
 }finally{fs.rmSync(external,{recursive:true,force:true})}
}));
test('a file at quarantine directory path is unsafe',()=>folder(dir=>{
 const fp=prepare(dir);fs.writeFileSync(path.join(dir,'quarantine'),'do not touch');
 assert.equal(call(dir,fp).status,'UNSAFE_QUARANTINE_DIRECTORY');
}));
test('lock directory blocks even a matching pair',()=>folder(dir=>{
 const fp=prepare(dir);fs.mkdirSync(path.join(dir,'quarantine'));
 fs.linkSync(source(dir),destination(dir,fp));fs.mkdirSync(path.join(dir,'writer.lock'));
 assert.equal(call(dir,fp).status,'LOCK_PRESENT_REVIEW_REQUIRED');
 assert.equal(fs.existsSync(source(dir)),true);
}));
test('dangling symlink writer lock also blocks inspection',()=>folder(dir=>{
 const fp=prepare(dir);fs.symlinkSync(path.join(dir,'missing-lock'),path.join(dir,'writer.lock'));
 assert.equal(call(dir,fp).status,'LOCK_PRESENT_REVIEW_REQUIRED');
}));
test('external hardlink increases count and is never classified as source-only',()=>folder(dir=>{
 const fp=prepare(dir);fs.linkSync(source(dir),path.join(dir,'foreign-link'));
 assert.equal(call(dir,fp).status,'UNSAFE_FILE_REVIEW_REQUIRED');
 assert.equal(fs.existsSync(path.join(dir,'foreign-link')),true);
}));
test('invalid candidate name or digest cannot select arbitrary paths',()=>folder(dir=>{
 const fp=prepare(dir);
 for(const invalid of ['../'+name,'/tmp/'+name,'ledger.json','writer.lock',
  'ledger-99999999-1770000000000.tmp','other.tmp'])
  assert.equal(call(dir,fp,{name:invalid}).status,'INVALID_SELECTION');
 for(const invalid of ['0'.repeat(16),'G'.repeat(64),'../file',''])
  assert.equal(call(dir,fp,{expectedFingerprint:invalid}).status,'INVALID_SELECTION');
 assert.equal(fs.existsSync(source(dir)),true);
}));
test('rejects directories outside dedicated direct child of os.tmpdir',()=>{
 for(const directory of [process.cwd(),os.tmpdir(),'/mnt/data'])
  assert.throws(()=>call(directory,'0'.repeat(64)),/Only synthetic test directory/);
});
test('rejects root directory symlink even if name follows fixture prefix',()=>folder(dir=>{
 const symlink=path.join(os.tmpdir(),'vision-custody-durable-symlink-'+process.pid);
 fs.symlinkSync(dir,symlink);
 try{assert.throws(()=>call(symlink,'0'.repeat(64)),/Unsafe synthetic test directory/)}
 finally{fs.unlinkSync(symlink)}
}));
test('source exceeding maximum fixture size is unsafe, not read',()=>folder(dir=>{
 fs.writeFileSync(source(dir),Buffer.alloc(128*1024+1));
 assert.equal(call(dir,'0'.repeat(64)).status,'UNSAFE_FILE_REVIEW_REQUIRED');
}));
test('output cannot leak private path, bytes, hash or reviewer credentials',()=>folder(dir=>{
 const fp=prepare(dir);const result=JSON.stringify(call(dir,fp));
 assert.doesNotMatch(result,/vision-custody|ledger-123|[a-f0-9]{64}|synthetic data/);
 assert.match(result,/canAutoResolve\":false/);
}));
test('inspection never uses mutating filesystem calls',()=>{
 const code=fs.readFileSync('tests/fixtures/commercial-evidence-quarantine-reconciliation-lab.cjs','utf8');
 assert.match(code,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(code,/fs\.(?:writeFile|appendFile|rename|link|unlink|rmdir|mkdir|rm|chmod|copyFile)Sync\s*\(/);
});
