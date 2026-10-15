// OFFLINE LAB ONLY: sensitivity in byte-demand, not actual media/download/billing.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {SIZES,RANGE_COUNTS,CACHE_FRACTIONS,scenario,matrix,markdown}
 =require('./fixtures/commercial-delivery-sensitivity.cjs');

test('scenario matrix has exactly 27 unique workload/cache combinations',()=>{
 const rows=matrix();
 assert.equal(rows.length,27);
 assert.equal(new Set(rows.map(r=>[r.mediaBytes,r.rangesPerPreview,r.cacheByteFraction].join(':'))).size,27);
 assert.deepEqual(SIZES,[1e6,6e6,20e6]);
 assert.deepEqual(RANGE_COUNTS,[1,4,12]);
 assert.deepEqual(CACHE_FRACTIONS,[0,0.5,0.9]);
});
test('all 27 scenarios keep byte delivery constant between direct and proxy',()=>{
 for(const r of matrix()){
  assert.equal(r.deliveredBytes,r.signedTotalMediaToBrowserBytes);
  assert.equal(r.deliveredBytes,r.proxyToBrowserBytes);
  assert.equal(r.proxyTotalTransportBytes,2*r.deliveredBytes);
  assert.equal(r.proxyAuthorizationChecks,r.rangeGets);
  assert.equal(r.signOperations,1000);
 }
});
test('Range count increases authorization operations but not payload without redownload',()=>{
 const scenarios=[1,4,12].map(rangesPerPreview=>scenario({
  mediaBytes:6_000_000,rangesPerPreview,cacheByteFraction:0.5
 }));
 assert.deepEqual(scenarios.map(r=>r.proxyAuthorizationChecks),[1000,4000,12000]);
 assert.deepEqual(scenarios.map(r=>r.deliveredBytes),[6e9,6e9,6e9]);
 assert.deepEqual(scenarios.map(r=>r.signedOriginBytes),[3e9,3e9,3e9]);
});
test('cache fraction reduces signed origin traffic but never client media bytes',()=>{
 const trio=CACHE_FRACTIONS.map(cacheByteFraction=>scenario({
  mediaBytes:6e6,rangesPerPreview:4,cacheByteFraction
 }));
 assert.deepEqual(trio.map(r=>r.signedOriginBytes),[6e9,3e9,0.6e9]);
 assert.deepEqual(trio.map(r=>r.signedCachedBytes),[0,3e9,5.4e9]);
 assert.deepEqual(trio.map(r=>r.deliveredBytes),[6e9,6e9,6e9]);
});
test('proxy upstream cache changes origin share but never adds a free delivery leg',()=>{
 const a=scenario({mediaBytes:1e6,rangesPerPreview:12,cacheByteFraction:0,
  proxyCacheByteFraction:0});
 const b=scenario({mediaBytes:1e6,rangesPerPreview:12,cacheByteFraction:0,
  proxyCacheByteFraction:0.5});
 assert.equal(a.proxyUpstreamOriginBytes,1e9);
 assert.equal(b.proxyUpstreamOriginBytes,0.5e9);
 assert.equal(b.proxyUpstreamCachedBytes,0.5e9);
 assert.equal(b.proxyToBrowserBytes,1e9);
});
test('proxy transport is accounting for two legs, not prediction of double billing',()=>{
 const r=scenario({mediaBytes:20e6,rangesPerPreview:4,cacheByteFraction:0.9});
 assert.equal(r.proxyTotalTransportBytes,40e9);
 assert.equal(r.signedOriginBytes,2e9);
 assert.equal(r.proxyUpstreamOriginBytes,20e9);
 assert.equal(r.proxyToBrowserBytes,20e9);
});
test('repeat seeking may increase transmitted bytes and is an explicit factor',()=>{
 const base=scenario({mediaBytes:6e6,rangesPerPreview:12,cacheByteFraction:0.5});
 const repeat=scenario({mediaBytes:6e6,rangesPerPreview:12,cacheByteFraction:0.5,
  repeatTransferFactor:1.5});
 assert.equal(base.deliveredBytes,6e9);
 assert.equal(repeat.deliveredBytes,9e9);
 assert.equal(base.rangeGets,repeat.rangeGets);
});
test('scenario forbids negative, inaccurate, enormous and invalid ratios',()=>{
 const base={mediaBytes:6e6,rangesPerPreview:4,cacheByteFraction:0.5};
 for(const props of [
  {mediaBytes:-1},{mediaBytes:1.5},{mediaBytes:Infinity},
  {rangesPerPreview:0},{rangesPerPreview:1.2},{rangesPerPreview:256},
  {cacheByteFraction:-0.1},{cacheByteFraction:1.1},
  {cacheByteFraction:NaN},{previews:0},{previews:1.2},
  {repeatTransferFactor:-1},{repeatTransferFactor:0.4},
  {repeatTransferFactor:Infinity},{proxyCacheByteFraction:1.2}
 ])assert.throws(()=>scenario({...base,...props}),RangeError);
});
test('markdown output lists every combination without exposing URLs or tokens',()=>{
 const report=markdown(matrix());
 assert.equal(report.split('\n').filter(line=>line.startsWith('| ')).length,29);
 assert.match(report,/Cache simulado/);
 assert.match(report,/20 \| 12 \| 90%/);
 assert.doesNotMatch(report,/token=|Bearer |storage\/v1\/|customer-original/);
});
test('the matrix runs independently of operational SQL and Edge gateway',()=>{
 const fixture=fs.readFileSync('tests/fixtures/commercial-delivery-sensitivity.cjs','utf8');
 const sql=fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8');
 const gateway=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
 assert.match(fixture,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(sql,/delivery-sensitivity/);
 assert.doesNotMatch(gateway,/delivery-sensitivity/);
});
