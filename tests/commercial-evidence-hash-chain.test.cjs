// OFFLINE LAB. All forms and timestamps refer only to synthetic records.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {GENESIS,buildChain,verifyChain,renderChainReport}
 =require('./fixtures/commercial-evidence-hash-chain.cjs');
const sample=name=>JSON.parse(fs.readFileSync(
 'docs/implementation/'+name,'utf8'));
function records(){
 const early=sample('commercial-staging-evidence-template.json');
 const next=sample('commercial-staging-evidence-lab-example.json');
 return [
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:early},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:next}
 ];
}
function three(){
 const rows=records();
 rows.push({sequence:3,recordedAt:'2026-10-15T12:15:00Z',
  form:structuredClone(rows[1].form)});
 return rows;
}
const codes=(chain,options)=>verifyChain(chain,options).alerts.map(x=>x.code);
test('genesis is a fixed 256-bit marker with deterministic two-snapshot head',()=>{
 const one=buildChain(records()),two=buildChain(records());
 assert.equal(GENESIS,'0'.repeat(64));
 assert.equal(one[0].previousHash,GENESIS);
 assert.equal(one[1].previousHash,one[0].hash);
 assert.deepEqual(one,two);
 assert.match(one[1].hash,/^[a-f0-9]{64}$/);
});
test('valid history has no cryptographic alerts but no staging entitlement',()=>{
 const r=verifyChain(buildChain(records()));
 assert.equal(r.records,2);
 assert.equal(r.chainConsistent,true);
 assert.equal(r.historyNeedsReview,false);
 assert.equal(r.checkedAgainstSuppliedHead,false);
 assert.equal(r.externalAnchorAuthenticityVerified,false);
 assert.equal(r.stagingProvenanceVerified,false);
 assert.equal(r.canConnectStaging,false);
 assert.equal(r.canDeployToProduction,false);
});
test('canonical hashing ignores JSON object key insertion order',()=>{
 const left=records();
 const right=structuredClone(left);
 right[1].form={checks:right[1].form.checks,
  approvals:right[1].form.approvals,
  policy:right[1].form.policy,environment:right[1].form.environment,
  scope:right[1].form.scope,version:right[1].form.version};
 assert.equal(buildChain(left)[1].hash,buildChain(right)[1].hash);
});
test('a byte or status change in first snapshot breaks its digest and next link remains reviewable',()=>{
 const chain=buildChain(records());
 chain[0].form.checks[0].status='FAIL';
 assert.ok(codes(chain).includes('RECORD_DIGEST_MISMATCH'));
 assert.equal(verifyChain(chain).chainConsistent,false);
});
test('changing a later declaration of a media evidence digest is detected',()=>{
 const chain=buildChain(records());
 chain[1].form.checks.find(x=>x.id==='ENV-02').evidence[0].sha256='c'.repeat(64);
 assert.ok(codes(chain).includes('RECORD_DIGEST_MISMATCH'));
});
test('valid UTC timestamp change cannot bypass hash integrity',()=>{
 const chain=buildChain(records());
 chain[1].recordedAt='2026-10-15T12:11:00Z';
 assert.ok(codes(chain).includes('RECORD_DIGEST_MISMATCH'));
});
test('changing previousHash produces both a pointer and digest mismatch',()=>{
 const chain=buildChain(records());
 chain[1].previousHash='e'.repeat(64);
 const alerts=codes(chain);
 assert.ok(alerts.includes('PREVIOUS_LINK_MISMATCH'));
 assert.ok(alerts.includes('RECORD_DIGEST_MISMATCH'));
});
test('altering the stored chain digest breaks the next link',()=>{
 const chain=buildChain(three());
 chain[1].hash='d'.repeat(64);
 const r=verifyChain(chain);
 assert.ok(r.alerts.some(x=>x.code==='RECORD_DIGEST_MISMATCH'&&x.sequence===2));
 assert.ok(r.alerts.some(x=>x.code==='PREVIOUS_LINK_MISMATCH'&&x.sequence===3));
});
test('removing or swapping a middle snapshot fails closed on chronology',()=>{
 const chain=buildChain(three());
 assert.throws(()=>verifyChain([chain[0],chain[2]]),/sequence/);
 assert.throws(()=>verifyChain([chain[1],chain[0],chain[2]]),/sequence/);
});
test('removing final entry remains a valid prefix WITHOUT external reference',()=>{
 const chain=buildChain(three());
 const truncated=chain.slice(0,2);
 assert.equal(verifyChain(truncated).chainConsistent,true);
 assert.equal(verifyChain(truncated).checkedAgainstSuppliedHead,false);
 const pinned=verifyChain(truncated,{expectedHead:chain[2].hash});
 assert.equal(pinned.chainConsistent,false);
 assert.ok(pinned.alerts.some(x=>x.code==='EXPECTED_HEAD_MISMATCH'));
});
test('adding a new valid record changes the final head and can be detected with a prior reference',()=>{
 const before=buildChain(records()),after=buildChain(three());
 assert.equal(verifyChain(after).chainConsistent,true);
 assert.ok(codes(after,{expectedHead:before.at(-1).hash}).includes('EXPECTED_HEAD_MISMATCH'));
});
test('full history rewrite can produce a new valid chain without proving the old one',()=>{
 const a=records();
 const old=buildChain(a);
 const rewritten=records();
 rewritten[0].form.checks[0].status='FAIL';
 const forged=buildChain(rewritten);
 assert.equal(verifyChain(forged).chainConsistent,true);
 const pinned=verifyChain(forged,{expectedHead:old.at(-1).hash});
 assert.equal(pinned.chainConsistent,false);
 assert.equal(pinned.suppliedHeadMatches,false);
 assert.equal(pinned.externalAnchorAuthenticityVerified,false);
});
test('a supplied digest that matches does not authenticate who supplied it',()=>{
 const chain=buildChain(records());
 const check=verifyChain(chain,{expectedHead:chain.at(-1).hash});
 assert.equal(check.chainConsistent,true);
 assert.equal(check.checkedAgainstSuppliedHead,true);
 assert.equal(check.suppliedHeadMatches,true);
 assert.equal(check.externalAnchorAuthenticityVerified,false);
 assert.equal(check.canRunRealStaging,false);
});
test('malformed expected hashes, extra fields and secret-bearing content are rejected',()=>{
 const chain=buildChain(records());
 assert.throws(()=>verifyChain(chain,{expectedHead:'not-a-digest'}),/externally provided/);
 const extra=structuredClone(chain);extra[0].raw='example';
 assert.throws(()=>verifyChain(extra),/chained record fields/);
 const secret=structuredClone(chain);
 secret[1].form.checks[0].auth='credential-placeholder';
 assert.throws(()=>verifyChain(secret),/Invalid fields at criterion/);
});
test('malformed entries with uppercase digest are rejected',()=>{
 const chain=buildChain(records());
 chain[0].hash=chain[0].hash.toUpperCase();
 assert.throws(()=>verifyChain(chain),/Invalid chain index or digest/);
});
test('building the chain clones forms, not reusing mutable caller objects',()=>{
 const data=records(),chain=buildChain(data);
 data[0].form.checks[0].status='FAIL';
 assert.equal(verifyChain(chain).chainConsistent,true);
});
test('history status anomalies remain visible even when chain hashes are consistent',()=>{
 const data=records();
 data[1].form.checks[2].status='NOT_RUN'; // Previously BLOCKED; still schema-valid.
 const chain=buildChain(data);
 const report=verifyChain(chain);
 assert.equal(report.chainConsistent,true);
 assert.equal(report.canDeployToProduction,false);
});
test('report displays no raw hash, token or original object path',()=>{
 const chain=buildChain(records());
 chain[1].previousHash='e'.repeat(64);
 const out=renderChainReport(verifyChain(chain));
 assert.match(out,/PREVIOUS_LINK_MISMATCH/);
 assert.match(out,/não autorizados/);
 assert.doesNotMatch(out,/e{64}|Bearer |token=|\/storage\//);
});
test('history length and unsupported values fail closed',()=>{
 assert.throws(()=>buildChain([]),/1-30 snapshots/);
 assert.throws(()=>verifyChain([]),/1-30 records/);
 const wrong=buildChain(records());wrong[0].sequence=0;
 assert.throws(()=>verifyChain(wrong),/Invalid chain index/);
});
test('hash implementation remains isolated from player gateway or SQL',()=>{
 const source=fs.readFileSync('tests/fixtures/commercial-evidence-hash-chain.cjs','utf8');
 const sql=fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8');
 assert.match(source,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(source,/\b(?:fetch|writeFileSync|spawn|execFileSync)\s*\(/);
 assert.doesNotMatch(sql,/commercial-evidence-hash-chain/);
});
