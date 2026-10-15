// Offline, synthetic audit history only. No contact with staging.
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {inspectHistory,renderHistory}=require('./fixtures/commercial-evidence-history.cjs');
const {REQUIREMENTS}=require('./fixtures/commercial-staging-evidence.cjs');
const form=file=>JSON.parse(fs.readFileSync('docs/implementation/'+file,'utf8'));
const base=()=>form('commercial-staging-evidence-template.json');
const filled=()=>form('commercial-staging-evidence-lab-example.json');
const pair=(a=base(),b=filled())=>[
 {sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:a},
 {sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:b}
];
const get=(x,id)=>x.checks.find(y=>y.id===id);
const proof=(ref,gate,source='LAB',sha='b'.repeat(64))=>({
 ref,type:REQUIREMENTS[gate],source,sha256:sha,observedAt:'2026-10-15T12:00:00Z'
});
const append=(history)=>{
 const next=structuredClone(history.at(-1));
 next.sequence=history.length+1;next.recordedAt='2026-10-15T12:15:00Z';
 history.push(next);return next.form;
};
const codes=h=>inspectHistory(h).issues.map(x=>x.code);
test('two clean synthetic snapshots have no alarms or authorization',()=>{
 const x=inspectHistory(pair());
 assert.equal(x.structurallyConsistent,true);
 assert.equal(x.snapshotCount,2);
 assert.equal(x.totalCriteria,17);
 assert.deepEqual(x.summaries.map(s=>s.evidenceReferences),[0,1]);
 assert.equal(x.stagingOriginVerified,false);
 assert.equal(x.canRunRealStaging,false);
 assert.equal(x.canDeployToProduction,false);
});
test('retaining an unchanged opaque reference in later runs is permitted',()=>{
 const h=pair();append(h);
 assert.deepEqual(codes(h),[]);
});
test('same reference with a new digest produces a review alarm',()=>{
 const h=pair();const f=append(h);
 get(f,'ENV-02').evidence[0].sha256='c'.repeat(64);
 assert.ok(codes(h).includes('REFERENCE_DIGEST_CHANGED'));
});
test('altered observation date is detected',()=>{
 const h=pair();const f=append(h);
 get(f,'ENV-02').evidence[0].observedAt='2026-10-15T12:03:00Z';
 assert.ok(codes(h).includes('EVIDENCE_TIMESTAMP_REWRITTEN'));
});
test('reused reference for a different criterion is rejected as rebound',()=>{
 const h=pair();const f=append(h),ev=get(f,'ENV-02').evidence.pop();
 ev.type=REQUIREMENTS['RLS-01'];get(f,'RLS-01').evidence=[ev];
 assert.ok(codes(h).includes('REFERENCE_REBOUND'));
 assert.ok(codes(h).includes('EVIDENCE_REFERENCE_REMOVED'));
});
test('one digest cannot silently be reassigned to another reference',()=>{
 const h=pair();const f=append(h);
 get(f,'RLS-01').evidence=[proof('EV-00000002','RLS-01','LAB',
  get(f,'ENV-02').evidence[0].sha256)];
 assert.ok(codes(h).includes('DIGEST_REUSED_UNDER_DIFFERENT_REF'));
});
test('changing a previous LAB reference into an unverified STAGING claim is flagged',()=>{
 const h=pair();const f=append(h);
 get(f,'ENV-02').evidence[0].source='STAGING';
 get(f,'ENV-02').status='PASS';
 const x=inspectHistory(h);
 assert.ok(x.issues.some(y=>y.code==='EVIDENCE_SOURCE_PROMOTED_OR_CHANGED'));
 assert.ok(x.issues.some(y=>y.code==='LAB_HASH_RELABELED_STAGING'));
 assert.equal(x.stagingOriginVerified,false);
});
test('new STAGING reference reusing historical LAB digest is flagged',()=>{
 const h=pair();const f=append(h);
 get(f,'RLS-01').evidence=[proof('EV-00000003','RLS-01','STAGING',
  get(f,'ENV-02').evidence[0].sha256)];
 get(f,'RLS-01').status='PASS';
 assert.ok(codes(h).includes('LAB_HASH_RELABELED_STAGING'));
 assert.ok(codes(h).includes('DIGEST_REUSED_UNDER_DIFFERENT_REF'));
});
test('PASS regression requires review even if new status is a legitimate failure',()=>{
 for(const status of ['NOT_RUN','FAIL','BLOCKED']){
  const a=filled(),b=filled();
  get(a,'ENV-02').evidence[0].source='STAGING';
  get(b,'ENV-02').evidence[0].source='STAGING';
  get(a,'ENV-02').status='PASS';get(b,'ENV-02').status=status;
  assert.ok(codes(pair(a,b)).includes('STATUS_REGRESSION_REVIEW'));
 }
});
test('SQL BLOCKED elevated to PASS without external authentication is flagged',()=>{
 const h=pair(base(),base());
 const row=get(h[1].form,'SQL-01');
 row.evidence=[proof('EV-00000004','SQL-01','STAGING')];row.status='PASS';
 assert.ok(codes(h).includes('BLOCKED_STATUS_ELEVATION_UNVERIFIED'));
 assert.ok(codes(h).includes('NEW_PASS_REQUIRES_INDEPENDENT_REVIEW'));
});
test('removing a previously declared reference is detected',()=>{
 assert.ok(codes(pair(filled(),base())).includes('EVIDENCE_REFERENCE_REMOVED'));
});
test('out-of-order snapshot timestamps and future observedAt are alerts',()=>{
 const h=pair();h[1].recordedAt='2026-10-15T11:59:00Z';
 assert.ok(codes(h).includes('SNAPSHOT_TIME_NON_MONOTONIC'));
 assert.ok(codes(h).includes('EVIDENCE_OBSERVED_AFTER_SNAPSHOT'));
});
test('sequence gaps, duplicates and unexpected keys are rejected',()=>{
 for(const number of [0,1,3,-1,1.2]){
  const h=pair();h[1].sequence=number;
  assert.throws(()=>inspectHistory(h),/sequence/);
 }
 const h=pair();h[1].extraField='not-allowed';
 assert.throws(()=>inspectHistory(h),/Unexpected historical snapshot/);
});
test('malformed UTC timestamps never become valid history events',()=>{
 for(const timestamp of ['2026-02-30T12:00:00Z',
  '2026-10-15T12:00:00-03:00','2026-10-15T25:00:00Z']){
  const h=pair();h[1].recordedAt=timestamp;
  assert.throws(()=>inspectHistory(h),/snapshot UTC timestamp/);
 }
});
test('synthetic all-PASS history never grants access or a deploy',()=>{
 const h=pair(),f=append(h);
 f.environment={approvedForStaging:true,isolated:true,productionCredentialsExcluded:true};
 f.policy={selected:'SIGNED_SHORT',residualAccepted:true};
 f.approvals={reviewerSignedOff:true,productionDeployAuthorized:false};
 f.checks.forEach((row,i)=>{row.status='PASS';row.evidence=[
  proof('EV-'+String(i+1).padStart(8,'0'),row.id,'STAGING',
   (i+1).toString(16).padStart(64,'0'))
 ]});
 const x=inspectHistory(h);
 assert.ok(codes(h).includes('NEW_PASS_REQUIRES_INDEPENDENT_REVIEW'));
 assert.equal(x.stagingOriginVerified,false);
 assert.equal(x.canDeployToProduction,false);
});
test('report renders codes and opaque references without hash digests',()=>{
 const h=pair(),f=append(h);
 get(f,'ENV-02').evidence[0].sha256='c'.repeat(64);
 const out=renderHistory(inspectHistory(h));
 assert.match(out,/REFERENCE_DIGEST_CHANGED/);
 assert.match(out,/EV-00000001/);
 assert.doesNotMatch(out,/c{64}|3c3f14fb/);
});
test('empty and oversized chronology and raw form fields fail closed',()=>{
 assert.throws(()=>inspectHistory([]),/1-30/);
 assert.throws(()=>inspectHistory(Array(31).fill(null)),/1-30/);
 const h=pair();get(h[1].form,'ENV-02').evidence[0].extra='unvalidated';
 assert.throws(()=>inspectHistory(h),/Invalid fields at evidence/);
});
