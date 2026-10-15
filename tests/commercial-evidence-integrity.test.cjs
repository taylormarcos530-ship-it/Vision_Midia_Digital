// OFFLINE LAB ONLY. Tests real SHA256 of disposable synthetic fixture files.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {newForm,REQUIREMENTS}=require('./fixtures/commercial-staging-evidence.cjs');
const {FIXTURE_DIR,MAX_BYTES,verifyLocalFixtureHashes,renderIntegrity,hashOfBytes}
 =require('./fixtures/commercial-evidence-integrity.cjs');
const digest=text=>hashOfBytes(Buffer.from(text));
const fixed=JSON.parse(fs.readFileSync('docs/implementation/commercial-staging-evidence-lab-example.json','utf8'));
const fixture=(ref='EV-00000001',gate='ENV-02')=>
 JSON.stringify({fixture:'VISION-LAB-ONLY',gate,ref,result:'SIMULATED'})+'\n';
const makeForm=(body=fixture(),sha=digest(body),source='LAB')=>{
 const form=newForm();
 form.checks.find(x=>x.id==='ENV-02').evidence=[{
  ref:'EV-00000001',type:REQUIREMENTS['ENV-02'],source,
  sha256:sha,observedAt:'2026-10-15T12:00:00Z'
 }];
 return form;
};
function withTmp(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-evidence-lab-'));
 try{return fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
function store(dir,content=fixture(),name='EV-00000001.json'){
 fs.writeFileSync(path.join(dir,name),content);
}
test('committed example points to one real synthetic artifact and SHA256 actually matches',()=>{
 const result=verifyLocalFixtureHashes(fixed);
 assert.equal(result.total,1);
 assert.equal(result.totals.MATCH,1);
 assert.equal(result.totals.MISMATCH,0);
 assert.equal(result.stagingProvenanceVerified,false);
 assert.equal(result.allLocalLabHashesMatch,true);
 assert.equal(result.schemaReadyForHumanReview,false);
 assert.equal(result.canConnectStaging,false);
 assert.equal(result.canRunRealStaging,false);
 assert.equal(result.canDeployToProduction,false);
 assert.equal(fs.readFileSync(path.join(FIXTURE_DIR,'EV-00000001.json'),'utf8'),fixture());
});
test('canonical baseline remains untouched and does not pretend LAB evidence is staging',()=>{
 const original=JSON.parse(fs.readFileSync('docs/implementation/commercial-staging-evidence-template.json','utf8'));
 const result=verifyLocalFixtureHashes(original);
 assert.equal(result.total,0);
 assert.equal(result.allLocalLabHashesMatch,false);
 assert.equal(result.stagingProvenanceVerified,false);
 assert.equal(original.checks.filter(x=>x.status==='BLOCKED').length,2);
 assert.equal(original.checks.every(x=>x.evidence.length===0),true);
});
test('local SHA256 matches the exact bytes of a synthetic file, not its description',()=>{
 withTmp(dir=>{
  const body=fixture();store(dir,body);
  const result=verifyLocalFixtureHashes(makeForm(body),{directory:dir});
  assert.deepEqual(result.outcomes.map(x=>x.hashStatus),['MATCH']);
  assert.equal(result.totals.MATCH,1);
 });
});
test('tampering one byte after digest declaration is reported as MISMATCH',()=>{
 withTmp(dir=>{
  const body=fixture();
  store(dir,body.replace('SIMULATED','SIMULATEd'));
  const result=verifyLocalFixtureHashes(makeForm(body),{directory:dir});
  // Deliberate different JSON field value is rejected by allowlisted fixture schema.
  assert.equal(result.outcomes[0].hashStatus,'REJECTED');
  store(dir,JSON.stringify({result:'SIMULATED',ref:'EV-00000001',
   gate:'ENV-02',fixture:'VISION-LAB-ONLY'})+'\n');
  assert.equal(verifyLocalFixtureHashes(makeForm(body),{directory:dir})
   .outcomes[0].hashStatus,'MISMATCH','valid but reordered JSON has different byte hash');
 });
});
test('missing artifact is reported as MISSING, without printing a path',()=>{
 withTmp(dir=>{
  const result=verifyLocalFixtureHashes(makeForm(),{directory:dir});
  assert.equal(result.outcomes[0].hashStatus,'MISSING');
  assert.equal(JSON.stringify(result).includes(dir),false);
 });
});
test('symbolic link to another file is rejected instead of followed',()=>{
 withTmp(dir=>{
  const target=path.join(dir,'safe-synthetic.json');
  fs.writeFileSync(target,fixture());
  fs.symlinkSync(target,path.join(dir,'EV-00000001.json'));
  const result=verifyLocalFixtureHashes(makeForm(),{directory:dir});
  assert.equal(result.outcomes[0].hashStatus,'REJECTED');
 });
});
test('hardlinked evidence file is rejected to prevent ambiguous provenance',()=>{
 withTmp(dir=>{
  const target=path.join(dir,'synthetic-original.json');
  fs.writeFileSync(target,fixture());
  fs.linkSync(target,path.join(dir,'EV-00000001.json'));
  const result=verifyLocalFixtureHashes(makeForm(),{directory:dir});
  assert.equal(result.outcomes[0].hashStatus,'REJECTED');
 });
});
test('file larger than MAX_BYTES is rejected before its contents are hashed',()=>{
 withTmp(dir=>{
  store(dir,'X'.repeat(MAX_BYTES+1));
  const result=verifyLocalFixtureHashes(makeForm(),{directory:dir});
  assert.equal(result.outcomes[0].hashStatus,'REJECTED');
 });
});
test('file with correct hash but invalid fixture fields still fails closed',()=>{
 withTmp(dir=>{
  const raw=JSON.stringify({fixture:'VISION-LAB-ONLY',gate:'ENV-02',
   ref:'EV-00000001',result:'SIMULATED',url:'https://fake.invalid/?token=synthetic'})+'\n';
  store(dir,raw);
  assert.equal(verifyLocalFixtureHashes(makeForm(raw),{directory:dir})
   .outcomes[0].hashStatus,'REJECTED');
 });
});
test('file with matching hash but wrong gate or reference is rejected',()=>{
 withTmp(dir=>{
  const raw=fixture('EV-00000002','RLS-01');
  store(dir,raw);
  const result=verifyLocalFixtureHashes(makeForm(raw),{directory:dir});
  assert.equal(result.outcomes[0].hashStatus,'REJECTED');
 });
});
test('unknown external or ancestor fixture directories are never opened',()=>{
 for(const dir of ['/etc','/mnt/data','../secrets',path.join(os.tmpdir(),'other-evidence')])
  assert.throws(()=>verifyLocalFixtureHashes(makeForm(),{directory:dir}),/permitted synthetic fixture directory/);
});
test('options reject attempts to inject arbitrary file path keys',()=>{
 withTmp(dir=>{
  store(dir);
  assert.throws(()=>verifyLocalFixtureHashes(makeForm(),{
   directory:dir,path:'../production.env'}),/Only an isolated fixture directory/);
 });
});
test('symlinked top-level fixture directory is rejected',()=>{
 withTmp(dir=>{
  const other=fs.mkdtempSync(path.join(os.tmpdir(),'vision-evidence-lab-'));
  try{
   fs.rmdirSync(other);
   fs.symlinkSync(dir,other,'dir');
   assert.throws(()=>verifyLocalFixtureHashes(makeForm(),{directory:other}),/Fixture directory unavailable or unsafe/);
  }finally{fs.rmSync(other,{recursive:true,force:true})}
 });
});
test('a STAGING origin claim remains SOURCE_UNVERIFIED despite identical bytes in LAB',()=>{
 withTmp(dir=>{
  store(dir);
  const result=verifyLocalFixtureHashes(makeForm(fixture(),digest(fixture()),'STAGING'),{directory:dir});
  assert.equal(result.totals.SOURCE_UNVERIFIED,1);
  assert.equal(result.totals.MATCH,0);
  assert.equal(result.stagingProvenanceVerified,false);
  assert.equal(result.canDeployToProduction,false);
 });
});
test('all self-described STAGING PASS checks remain unauthenticated by local hash',()=>{
 const form=newForm();
 form.environment={approvedForStaging:true,isolated:true,productionCredentialsExcluded:true};
 form.policy={selected:'SIGNED_SHORT',residualAccepted:true};
 form.approvals={reviewerSignedOff:true,productionDeployAuthorized:false};
 form.checks.forEach((row,i)=>{
  row.status='PASS';row.evidence=[{
   ref:'EV-'+String(i+1).padStart(8,'0'),
   type:REQUIREMENTS[row.id],source:'STAGING',
   sha256:'f'.repeat(64),observedAt:'2026-10-15T12:00:00Z'
  }];
 });
 const result=verifyLocalFixtureHashes(form);
 assert.equal(result.totals.SOURCE_UNVERIFIED,17);
 assert.equal(result.schemaReadyForHumanReview,true);
 assert.equal(result.stagingProvenanceVerified,false);
 assert.equal(result.canConnectStaging,false);
 assert.equal(result.canDeployToProduction,false);
});
test('renderer shows only opaque references and check outcomes, never digest or bytes',()=>{
 const text=renderIntegrity(verifyLocalFixtureHashes(fixed));
 assert.match(text,/EV-00000001 \| LAB \| MATCH/);
 assert.match(text,/Hash coincidente não prova autenticidade/);
 assert.doesNotMatch(text,/3c3f14fb|private-owner|Bearer |token=|\/storage\//);
});
test('the read-only local utility is runnable and emits one MATCH with zero staging permission',()=>{
 const p=spawnSync(process.execPath,['tests/tools/commercial-evidence-hash-report.cjs'],{
  cwd:process.cwd(),encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 assert.match(p.stdout,/EV-00000001 \| LAB \| MATCH/);
 assert.match(p.stdout,/Staging real \/ produção:\*\* não autorizados/);
 assert.doesNotMatch(p.stdout,/sha256|3c3f14fb|token=|Bearer /);
 assert.equal(p.stderr,'');
});
test('operational SQL, player, auth API and package scripts remain unmodified by this fixture',()=>{
 const moduleCode=fs.readFileSync('tests/fixtures/commercial-evidence-integrity.cjs','utf8');
 const sql=fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8');
 const gateway=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
 assert.match(moduleCode,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(moduleCode,/\b(?:fetch|axios|https\.request|spawn|execFileSync)\s*\(/);
 assert.doesNotMatch(sql,/commercial-evidence-integrity/);
 assert.doesNotMatch(gateway,/commercial-evidence-integrity/);
});
