// OFFLINE LAB: fake independent custody for synthetic evidence hash-chain heads.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {buildChain}=require('./fixtures/commercial-evidence-hash-chain.cjs');
const {ZERO,issueLabAnchor,verifyLabAnchors,renderLabAnchorReport}
 =require('./fixtures/commercial-evidence-external-anchor.cjs');
const fromFile=name=>JSON.parse(fs.readFileSync('docs/implementation/'+name,'utf8'));
function snapshots(){
 const first=fromFile('commercial-staging-evidence-template.json');
 const second=fromFile('commercial-staging-evidence-lab-example.json');
 return [
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:first},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:second},
  {sequence:3,recordedAt:'2026-10-15T12:15:00Z',form:structuredClone(second)}
 ];
}
const chain=()=>buildChain(snapshots());
const a1=c=>issueLabAnchor(c,{recordCount:2,stampedAt:'2026-10-15T12:11:00Z'});
const pair=c=>{const first=a1(c);return [first,issueLabAnchor(c,{
 previous:first,recordCount:3,stampedAt:'2026-10-15T12:16:00Z'
})]};
const ids=r=>r.alerts.map(x=>x.code);
test('two anchors link snapshots 2 and 3; independently supplied digest compares equal',()=>{
 const c=chain(),anchors=pair(c);
 assert.equal(anchors[0].anchorNumber,1);
 assert.equal(anchors[0].previousAnchorHash,ZERO);
 assert.equal(anchors[0].recordCount,2);
 assert.equal(anchors[1].previousAnchorHash,anchors[0].receiptHash);
 assert.equal(anchors[1].headHash,c[2].hash);
 const r=verifyLabAnchors(c,anchors,{independentlyHeldDigest:anchors[1].receiptHash});
 assert.equal(r.locallyConsistent,true);
 assert.equal(r.independentHeadCompared,true);
 assert.equal(r.independentHeadMatches,true);
 assert.equal(r.independentAnchorAuthenticityVerified,false);
 assert.equal(r.canRunRealStaging,false);
 assert.equal(r.canDeployToProduction,false);
});
test('anchor digest is deterministic across identical synthetic inputs',()=>{
 const c=chain();
 assert.deepEqual(pair(c),pair(c));
 assert.match(pair(c)[1].receiptHash,/^[a-f0-9]{64}$/);
});
test('no independently held head means locally consistent NOT independently proved',()=>{
 const c=chain(),r=verifyLabAnchors(c,pair(c));
 assert.equal(r.locallyConsistent,true);
 assert.equal(r.independentHeadCompared,false);
 assert.equal(r.independentHeadMatches,null);
 assert.equal(r.independentAnchorAuthenticityVerified,false);
});
test('full history rewrite with recalculated receipts is detectable by retained head',()=>{
 const old=chain(),pin=pair(old)[1].receiptHash;
 const forgedInput=snapshots();
 forgedInput[0].form.checks[0].status='FAIL';
 const rewritten=buildChain(forgedInput),renewed=pair(rewritten);
 assert.equal(verifyLabAnchors(rewritten,renewed).locallyConsistent,true,
  'self-rewritten history and receipts appear consistent');
 const pinned=verifyLabAnchors(rewritten,renewed,{independentlyHeldDigest:pin});
 assert.equal(pinned.locallyConsistent,false);
 assert.ok(ids(pinned).includes('INDEPENDENT_HEAD_MISMATCH'));
 assert.equal(pinned.independentHeadMatches,false);
});
test('rewriting BOTH full chain and purported head has no external trust anchor',()=>{
 const c=chain(),orig=pair(c)[1].receiptHash;
 const x=snapshots();x[1].form.checks[0].status='FAIL';
 const fake=buildChain(x),replacement=pair(fake);
 assert.notEqual(replacement[1].receiptHash,orig);
 const r=verifyLabAnchors(fake,replacement,{
  independentlyHeldDigest:replacement[1].receiptHash});
 assert.equal(r.locallyConsistent,true);
 assert.equal(r.independentAnchorAuthenticityVerified,false);
});
test('removing last record while keeping receipt with 3 records triggers missing checkpoint',()=>{
 const c=chain(),anchors=pair(c);
 const r=verifyLabAnchors(c.slice(0,2),anchors);
 assert.ok(ids(r).includes('ANCHORED_RECORD_MISSING'));
 assert.equal(r.locallyConsistent,false);
});
test('removing the final snapshot and its receipt can fool an unpinned archive',()=>{
 const c=chain(),anchors=pair(c);
 const noPin=verifyLabAnchors(c.slice(0,2),anchors.slice(0,1));
 assert.equal(noPin.locallyConsistent,true);
 const withPin=verifyLabAnchors(c.slice(0,2),anchors.slice(0,1),{
  independentlyHeldDigest:anchors[1].receiptHash});
 assert.ok(ids(withPin).includes('INDEPENDENT_HEAD_MISMATCH'));
});
test('adding unanchored history tail is flagged for sealing',()=>{
 const c=chain();
 const r=verifyLabAnchors(c,[a1(c)]);
 assert.ok(ids(r).includes('UNANCHORED_HISTORY_TAIL'));
});
test('altered receipt digest is detected before trusting a rotated anchor',()=>{
 const c=chain(),anchors=pair(c);
 anchors[0]={...anchors[0],receiptHash:'f'.repeat(64)};
 const r=verifyLabAnchors(c,anchors);
 assert.ok(ids(r).includes('ANCHOR_RECEIPT_TAMPERED'));
 assert.ok(ids(r).includes('ANCHOR_LINK_MISMATCH'));
});
test('altered receipt head and timestamp invalidate checksum even with same chain',()=>{
 const c=chain(),anchors=pair(c);
 anchors[1]={...anchors[1],headHash:'a'.repeat(64),
  stampedAt:'2026-10-15T12:17:00Z'};
 const alerts=ids(verifyLabAnchors(c,anchors));
 assert.ok(alerts.includes('HISTORY_HEAD_MISMATCH'));
 assert.ok(alerts.includes('ANCHOR_RECEIPT_TAMPERED'));
});
test('rotations cannot repeat a previous record count, regress time or mismatch source',()=>{
 const c=chain(),initial=a1(c);
 assert.throws(()=>issueLabAnchor(c,{previous:initial,recordCount:2,
  stampedAt:'2026-10-15T12:20:00Z'}),/strictly advance/);
 assert.throws(()=>issueLabAnchor(c,{previous:initial,recordCount:3,
  stampedAt:'2026-10-15T12:10:00Z'}),/predates|strictly advance/);
 const damaged={...initial,receiptHash:'b'.repeat(64)};
 assert.throws(()=>issueLabAnchor(c,{previous:damaged,recordCount:3,
  stampedAt:'2026-10-15T12:16:00Z'}),/previous anchor checksum/);
});
test('rewritten history cannot rotate on old root without rebuilding receipt',()=>{
 const c=chain(),first=a1(c);
 const altered=snapshots();altered[0].form.checks[0].status='FAIL';
 const different=buildChain(altered);
 assert.throws(()=>issueLabAnchor(different,{previous:first,
  recordCount:3,stampedAt:'2026-10-15T12:16:00Z'}),/matching checkpoint/);
});
test('duplicate or skipped anchor numbers reject the ledger',()=>{
 const c=chain(),anchors=pair(c);
 anchors[1]={...anchors[1],anchorNumber:1};
 assert.throws(()=>verifyLabAnchors(c,anchors),/sequence/);
 anchors[1]={...anchors[1],anchorNumber:3};
 assert.throws(()=>verifyLabAnchors(c,anchors),/sequence/);
});
test('invalid extra fields, URLs or unsigned metadata are rejected in anchor receipts',()=>{
 const c=chain(),anchors=pair(c);
 anchors[0]={...anchors[0],signedURL:'https://example.invalid/?token=x'};
 assert.throws(()=>verifyLabAnchors(c,anchors),/receipt fields/);
});
test('malformed or uppercase externally claimed digest is rejected',()=>{
 const c=chain(),anchors=pair(c);
 assert.throws(()=>verifyLabAnchors(c,anchors,{
  independentlyHeldDigest:'not-a-digest'}),/independently supplied/);
 assert.throws(()=>verifyLabAnchors(c,anchors,{
  independentlyHeldDigest:'A'.repeat(64)}),/independently supplied/);
});
test('anchor timestamp may not precede referenced snapshot',()=>{
 const c=chain();
 assert.throws(()=>issueLabAnchor(c,{recordCount:2,
  stampedAt:'2026-10-15T12:09:00Z'}),/predates/);
});
test('no receipt or more than 30 receipts cannot be treated as valid ledger',()=>{
 const c=chain();
 assert.throws(()=>verifyLabAnchors(c,[]),/1-30/);
 assert.throws(()=>verifyLabAnchors(c,Array(31).fill(a1(c))),/1-30/);
});
test('history tampering without rebuilding digest generates mismatch independently',()=>{
 const c=chain(),anchors=pair(c);
 c[0].form.checks[0].status='FAIL';
 const r=verifyLabAnchors(c,anchors);
 assert.ok(ids(r).includes('HISTORY_CHAIN_INCONSISTENT'));
 assert.equal(r.locallyConsistent,false);
});
test('rendered report never includes full digests, JWT, paths or customer data',()=>{
 const c=chain(),anchors=pair(c);
 const out=renderLabAnchorReport(verifyLabAnchors(c,anchors,{
  independentlyHeldDigest:'f'.repeat(64)}));
 assert.match(out,/INDEPENDENT_HEAD_MISMATCH/);
 assert.match(out,/procedência NÃO certificada|DIVERGENTE/);
 assert.doesNotMatch(out,/[a-f0-9]{64}|Bearer |token=|source_storage_path/);
});
test('a matching digest never allows remote staging or production',()=>{
 const c=chain(),a=pair(c);
 const r=verifyLabAnchors(c,a,{independentlyHeldDigest:a[1].receiptHash});
 assert.equal(r.independentAnchorAuthenticityVerified,false);
 assert.equal(r.stagingOriginVerified,false);
 assert.equal(r.canConnectStaging,false);
 assert.equal(r.canRunRealStaging,false);
 assert.equal(r.canDeployToProduction,false);
});
test('anchor module is read-only and isolated from original SQL and player gateway',()=>{
 const source=fs.readFileSync('tests/fixtures/commercial-evidence-external-anchor.cjs','utf8');
 const sql=fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8');
 const gateway=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
 assert.match(source,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(source,/\b(?:fetch|axios|https\.request|writeFileSync|execFileSync)\s*\(/);
 assert.doesNotMatch(sql,/commercial-evidence-external-anchor/);
 assert.doesNotMatch(gateway,/commercial-evidence-external-anchor/);
});
