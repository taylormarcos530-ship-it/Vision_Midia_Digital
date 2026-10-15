// OFFLINE LAB: prove staging acceptance is explicit, evidenced and fail-closed.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {GATES,STATES,baseline,assess,evidenceSafe}
 =require('./fixtures/commercial-staging-readiness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
const completeSynthetic=()=>{
 const c=baseline();
 c.checks.forEach(row=>{row.status='PASS';row.evidence=['artifact:synthetic-negative-and-positive-contract']});
 c.environment={approvedForStaging:true,isolated:true,productionCredentialsExcluded:true};
 c.policy={selected:'SIGNED_SHORT',residualAccepted:true};
 c.approvals={reviewerSignedOff:true,productionDeployAuthorized:false};
 return c;
};
test('baseline rejects staging automatically with 17 mandatory unverified gates',()=>{
 const b=baseline(),result=assess(b);
 assert.equal(GATES.length,17);
 assert.equal(b.checks.length,17);
 assert.equal(result.passed,0);
 assert.equal(result.blockers.length,20); // 17 gates + environment + policy + signoff
 assert.equal(result.readyForHumanStagingReview,false);
 assert.equal(result.canRunRealStaging,false);
 assert.equal(result.canDeployToProduction,false);
});
test('original SQL vulnerability explicitly BLOCKED, not silently listed as fixed',()=>{
 const b=baseline();
 assert.equal(b.checks.find(x=>x.id==='SQL-01').status,'BLOCKED');
 assert.equal(b.checks.find(x=>x.id==='SQL-02').status,'BLOCKED');
 const original=fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8');
 const patch=fs.readFileSync('tests/fixtures/commercial-safe-projection-lab.sql','utf8');
 assert.match(original,/grant select on public\.vision_advertisers,public\.vision_commercial_campaigns,public\.vision_commercial_revisions/i);
 assert.match(original,/jsonb_agg\(to_jsonb\(r\)\)/);
 assert.match(patch,/REVOKE SELECT ON TABLE public\.vision_commercial_revisions/);
 assert.match(patch,/CREATE OR REPLACE FUNCTION private\.vision_portal_data/);
});
test('all status enum values are recognized, and no gate is optional',()=>{
 assert.deepEqual(STATES,['NOT_RUN','PASS','FAIL','BLOCKED']);
 assert.equal(GATES.every(x=>x.id&&x.name&&x.expected&&x.evidence&&x.severity),true);
 assert.equal(new Set(GATES.map(x=>x.id)).size,GATES.length);
 assert.equal(GATES.every(x=>x.severity==='critical'||x.severity==='high'),true);
});
test('one FAILED, BLOCKED or NOT_RUN criterion blocks review even if every other one is PASS',()=>{
 for(const status of ['FAIL','BLOCKED','NOT_RUN']){
  const c=completeSynthetic();c.checks.find(x=>x.id==='VIDEO-01').status=status;
  const result=assess(c);
  assert.equal(result.readyForHumanStagingReview,false);
  assert.ok(result.blockers.includes('VIDEO-01:'+status));
 }
});
test('missing SQL evidence cannot be overridden by signing an approval',()=>{
 const c=completeSynthetic();
 c.checks.find(x=>x.id==='SQL-02').evidence=[];
 assert.throws(()=>assess(c),/PASS without independent evidence/);
});
test('unknown, duplicated or omitted criteria cannot be accepted',()=>{
 const dup=completeSynthetic();dup.checks[1].id=dup.checks[0].id;
 assert.throws(()=>assess(dup),/duplicate/);
 const unknown=completeSynthetic();unknown.checks[1].id='UNKNOWN-EXTERNAL';
 assert.throws(()=>assess(unknown),/Unknown/);
 const missing=completeSynthetic();missing.checks.pop();
 assert.throws(()=>assess(missing),/Every staging gate/);
 const invalid=completeSynthetic();invalid.checks[2].status='SKIPPED';
 assert.throws(()=>assess(invalid),/Unknown/);
});
test('evidence cannot include signed URL query, bearer or source storage paths',()=>{
 for(const evidence of [
  'Authorization: Bearer fixture-secret',
  'https://server.test/path?token=fixture',
  'signedURL:"/object/sign/private"',
  '/storage/v1/object/sign/vision-media/private',
  "source_storage_path='private-owner/original.webp'",
  'service_role_key=do-not-include'
 ]){
  assert.equal(evidenceSafe(evidence),false,evidence.slice(0,15));
  const c=completeSynthetic();c.checks[0].evidence=[evidence];
  assert.throws(()=>assess(c),/Invalid\/redaction-unsafe/);
 }
});
test('staging cannot pass without independently approved isolated environment',()=>{
 for(const field of ['approvedForStaging','isolated','productionCredentialsExcluded']){
  const c=completeSynthetic();c.environment[field]=false;
  const r=assess(c);
  assert.equal(r.readyForHumanStagingReview,false);
  assert.ok(r.blockers.includes('STAGING_NOT_EXPLICITLY_AUTHORIZED_AND_ISOLATED'));
 }
});
test('short signed URL option requires written acknowledgement of residual access',()=>{
 const c=completeSynthetic();c.policy.residualAccepted=false;
 const r=assess(c);
 assert.equal(r.readyForHumanStagingReview,false);
 assert.ok(r.blockers.includes('RESIDUAL_BEARER_EXPOSURE_NOT_ACCEPTED'));
});
test('policy cannot remain undecided even when synthetic checks and reviewer flag are green',()=>{
 const c=completeSynthetic();c.policy.selected='UNDECIDED';
 assert.ok(assess(c).blockers.includes('DELIVERY_POLICY_UNDECIDED'));
});
test('human signoff is mandatory independent of tests and environment',()=>{
 const c=completeSynthetic();c.approvals.reviewerSignedOff=false;
 assert.equal(assess(c).readyForHumanStagingReview,false);
});
test('counterfactual all PASS is review eligibility only: never performs staging or production actions',()=>{
 const c=completeSynthetic();
 const r=assess(c);
 assert.equal(r.passed,17);
 assert.equal(r.readyForHumanStagingReview,true);
 assert.equal(r.canRunRealStaging,false);
 assert.equal(r.canDeployToProduction,false);
 c.approvals.productionDeployAuthorized=true;
 assert.equal(assess(c).canDeployToProduction,false);
});
test('explicit authenticated media delivery candidate also needs full human review',()=>{
 const c=completeSynthetic();c.policy={selected:'AUTH_PER_READ',residualAccepted:false};
 const r=assess(c);
 assert.equal(r.readyForHumanStagingReview,true);
 assert.equal(r.canDeployToProduction,false);
});
test('source and workflow stay entirely in the tests-only isolated branch',()=>{
 const source=fs.readFileSync('tests/fixtures/commercial-staging-readiness.cjs','utf8');
 const wf=fs.readFileSync('.github/workflows/advertiser-portal-safety.yml','utf8');
 const gateway=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
 assert.match(source,/OFFLINE LAB ONLY/);
 assert.match(wf,/Protect live player, APK and operational APIs/);
 assert.doesNotMatch(gateway,/commercial-staging-readiness/);
 assert.doesNotMatch(fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8'),
  /commercial-staging-readiness/);
});
