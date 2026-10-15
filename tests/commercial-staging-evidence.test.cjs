// OFFLINE LAB: validate evidence references only, never real auth tokens or uploads.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {GATES}=require('./fixtures/commercial-staging-readiness.cjs');
const {VERSION,PROVENANCE,REQUIREMENTS,newForm,verify,render}
 =require('./fixtures/commercial-staging-evidence.cjs');
const sample=()=>JSON.parse(fs.readFileSync('docs/implementation/commercial-staging-evidence-template.json','utf8'));
const digest='a'.repeat(64);
const proof=(id,index,source='STAGING')=>({
 ref:'EV-'+String(index).padStart(8,'0'),type:REQUIREMENTS[id],
 source,sha256:digest,observedAt:'2026-10-15T12:00:00Z'
});
const ready=()=>{
 const form=newForm();
 form.environment={approvedForStaging:true,isolated:true,productionCredentialsExcluded:true};
 form.policy={selected:'SIGNED_SHORT',residualAccepted:true};
 form.approvals={reviewerSignedOff:true,productionDeployAuthorized:false};
 form.checks.forEach((row,i)=>{row.status='PASS';row.evidence=[proof(row.id,i+1)]});
 return form;
};
test('JSON template matches the canonical 17-criterion redacted baseline',()=>{
 const form=sample(),canonical=newForm();
 assert.equal(VERSION,1);assert.deepEqual(form,canonical);
 assert.deepEqual(form.checks.map(x=>x.id),GATES.map(x=>x.id));
 assert.deepEqual(form.checks.filter(x=>x.status==='BLOCKED').map(x=>x.id),['SQL-01','SQL-02']);
});
test('empty template is blocked, contains zero evidence and cannot authorize staging',()=>{
 const result=verify(sample());
 assert.equal(result.total,17);assert.equal(result.passed,0);
 assert.equal(result.evidenceCount,0);assert.equal(result.stagingEvidenceCount,0);
 assert.equal(result.readyForHumanStagingReview,false);
 assert.equal(result.canRunRealStaging,false);
 assert.equal(result.canConnectStaging,false);
 assert.equal(result.canDeployToProduction,false);
});
test('LAB fixture proof alone cannot upgrade a criterion to PASS',()=>{
 const form=sample(),row=form.checks[0];
 row.status='PASS';row.evidence=[proof(row.id,1,'LAB')];
 assert.throws(()=>verify(form),/PASS requires a matching staging-source reference/);
});
test('LAB evidence may be linked as reference while a criterion remains NOT_RUN',()=>{
 const form=sample(),row=form.checks[0];
 row.evidence=[proof(row.id,1,'LAB')];
 const result=verify(form);
 assert.equal(result.passed,0);
 assert.equal(result.evidenceCount,1);
 assert.equal(result.labOnlyEvidenceCount,1);
 assert.equal(result.stagingEvidenceCount,0);
 assert.equal(result.readyForHumanStagingReview,false);
});
test('a self-described STAGING hash cannot authorize real staging or production',()=>{
 const result=verify(ready());
 assert.equal(result.passed,17);
 assert.equal(result.stagingEvidenceCount,17);
 assert.equal(result.readyForHumanStagingReview,true);
 assert.equal(result.canConnectStaging,false);
 assert.equal(result.canRunRealStaging,false);
 assert.equal(result.canDeployToProduction,false);
});
test('an explicit production approval flag is forbidden even for a fully green synthetic form',()=>{
 const form=ready();form.approvals.productionDeployAuthorized=true;
 assert.throws(()=>verify(form),/Production authorization is outside/);
});
test('any missing, failed or blocked criterion prevents review even with prior evidence',()=>{
 for(const status of ['NOT_RUN','FAIL','BLOCKED']){
  const form=ready();form.checks[4].status=status;
  const result=verify(form);
  assert.equal(result.readyForHumanStagingReview,false);
  assert.ok(result.blockers.includes('RLS-01:'+status));
 }
});
test('a missing staging isolation or reviewer decision blocks review',()=>{
 for(const property of ['approvedForStaging','isolated','productionCredentialsExcluded']){
  const form=ready();form.environment[property]=false;
  assert.equal(verify(form).readyForHumanStagingReview,false);
 }
 const form=ready();form.approvals.reviewerSignedOff=false;
 assert.equal(verify(form).readyForHumanStagingReview,false);
});
test('wrong evidence type cannot support a different security gate',()=>{
 const form=ready();form.checks[2].evidence[0].type='MEDIA_BROWSER_RUN';
 assert.throws(()=>verify(form),/Evidence type or source/);
});
test('same opaque reference cannot be re-used across any two gates',()=>{
 const form=ready();form.checks[1].evidence[0].ref=form.checks[0].evidence[0].ref;
 assert.throws(()=>verify(form),/Invalid or replayed opaque evidence reference/);
});
test('raw URLs, JWT, bearer headers and original paths cannot be hidden in extra properties',()=>{
 const fields=[
  ['url','https://fixture.invalid/secret?token=sensitive'],
  ['authorization','Bearer synthetic'],
  ['rawBody','private-owner/point-source.mp4'],
  ['screenshot','customer-personal-data']
 ];
 for(const [key,value] of fields){
  const form=ready();form.checks[0].evidence[0][key]=value;
  assert.throws(()=>verify(form),/Invalid fields at evidence/);
 }
});
test('rejects extra root fields and unrecognized gate properties before rendering',()=>{
 const extras=ready();extras.apiKey='sensitive';
 assert.throws(()=>verify(extras),/Invalid fields at root/);
 const more=ready();more.checks[0].note='A customer original media path';
 assert.throws(()=>verify(more),/Invalid fields at criterion/);
});
test('rejects bad ref, hash and malformed date instead of storing arbitrary raw proofs',()=>{
 const bad=[
  ['ref','https://secret.invalid?token=raw',/Invalid or replayed opaque/],
  ['sha256','sha256:ab',/SHA256 digest/],
  ['observedAt','2026-02-30T12:00:00Z',/Invalid canonical UTC/],
  ['observedAt','2026-10-15T12:00:00-03:00',/Invalid canonical UTC/],
  ['observedAt','2030-01-01T25:00:00Z',/Invalid canonical UTC/]
 ];
 for(const [field,value,pattern] of bad){
  const form=ready();form.checks[0].evidence[0][field]=value;
  assert.throws(()=>verify(form),pattern);
 }
});
test('rejects evidence list overflow, unsupported statuses and unknown provenance',()=>{
 const over=ready();
 over.checks[0].evidence=Array.from({length:11},(_,i)=>proof('ENV-01',100+i));
 assert.throws(()=>verify(over),/Evidence list must contain 0-10/);
 const state=ready();state.checks[0].status='APPROVED_FOR_PRODUCTION';
 assert.throws(()=>verify(state),/Unknown evidence status/);
 const source=ready();source.checks[0].evidence[0].source='PRODUCTION';
 assert.throws(()=>verify(source),/Evidence type or source/);
 assert.deepEqual(PROVENANCE,['LAB','STAGING']);
});
test('review text has all 17 criteria and references, never raw SHA or JWT',()=>{
 const form=ready();
 const report=render(form);
 assert.match(report,/17/);
 assert.match(report,/Elegível apenas para REVISÃO HUMANA/);
 assert.match(report,/Deploy de produção:\*\* proibido/);
 assert.match(report,/EV-00000001 \(STAGING\)/);
 assert.doesNotMatch(report,/a{64}|token=|Bearer /);
 for(const gate of GATES)assert.match(report,new RegExp(gate.id.replace('-','\\-')));
});
test('baseline report explains the two SQL blockers and zero staging evidence',()=>{
 const report=render(sample());
 assert.match(report,/SQL-01 \| BLOCKED/);
 assert.match(report,/SQL-02 \| BLOCKED/);
 assert.match(report,/BLOQUEADO \/ NÃO HOMOLOGADO/);
 assert.match(report,/Evidências registradas:\*\* 0/);
});
test('form schema is inert: neither executable writes nor operational changes',()=>{
 const source=fs.readFileSync('tests/fixtures/commercial-staging-evidence.cjs','utf8');
 const template=fs.readFileSync('docs/implementation/commercial-staging-evidence-template.json','utf8');
 assert.match(source,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(source,/\b(?:fetch|spawn|execFile|axios|https\.request)\s*\(/);
 assert.doesNotMatch(template,/\"status\": \"PASS\"/);
 const sql=fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8');
 const player=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
 assert.doesNotMatch(sql,/commercial-staging-evidence-template/);
 assert.doesNotMatch(player,/commercial-staging-evidence-template/);
});
