// LAB ONLY: safe, explicit aggregate HTTP telemetry for local advertising preview.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {collector,percentile}=require('./fixtures/commercial-delivery-metrics.cjs');
const e=(mode,kind,status,elapsedMs=1,other={})=>({mode,kind,status,
 elapsedMs,...other});
test('empty fixture produces zero counts and null latency quantiles',()=>{
 const r=collector().summary();
 assert.equal(r.signed.mediaGetRequests,0);
 assert.equal(r.proxy.mediaGetRequests,0);
 assert.equal(r.proxy.latencyMs.p50,null);
 assert.equal(r.signed.latencyMs.p95,null);
});
test('signed mode counts signing and two GET byte ranges without proxy outbound',()=>{
 const c=collector();
 c.record(e('signed','sign',200,4));
 c.record(e('signed','get',206,10,{bodyBytes:1024,originBytes:1024,rangeRequest:true}));
 c.record(e('signed','get',206,12,{bodyBytes:512,originBytes:512,rangeRequest:true}));
 const s=c.summary().signed;
 assert.equal(s.signRequests,1);
 assert.equal(s.mediaGetRequests,2);
 assert.equal(s.rangeRequests,2);
 assert.equal(s.bodyBytes,1536);
 assert.equal(s.originBytes,1536);
 assert.equal(s.proxyOutboundBytes,0);
 assert.equal(s.latencyMs.p50,10);
 assert.equal(s.latencyMs.p95,12);
});
test('cache hit is counted without incorrectly counting a new origin transfer',()=>{
 const c=collector();
 c.record(e('signed','get',206,5,{bodyBytes:1024,originBytes:1024,rangeRequest:true}));
 c.record(e('signed','get',206,1,{bodyBytes:1024,originBytes:0,cacheHit:true,rangeRequest:true}));
 const s=c.summary().signed;
 assert.equal(s.bodyBytes,2048);
 assert.equal(s.originBytes,1024);
 assert.equal(s.cacheHits,1);
});
test('proxy includes bytes delivered and an independently counted upstream leg',()=>{
 const c=collector();
 c.record(e('proxy','get',206,9,{bodyBytes:1024,originBytes:1024,
  proxyOutboundBytes:1024,rangeRequest:true}));
 const s=c.summary().proxy;
 assert.equal(s.bodyBytes,1024);
 assert.equal(s.originBytes,1024);
 assert.equal(s.proxyOutboundBytes,1024);
 assert.equal(s.successfulGetResponses,1);
});
test('both response errors 403 and 416 counted but no video bytes leaked',()=>{
 const c=collector();
 c.record(e('proxy','get',403,2,{rangeRequest:true}));
 c.record(e('signed','get',416,2,{rangeRequest:true}));
 assert.equal(c.summary().proxy.errors403,1);
 assert.equal(c.summary().signed.errors416,1);
 assert.equal(c.summary().proxy.bodyBytes,0);
});
test('latency percentiles are nearest-rank and use only media GET timings',()=>{
 const c=collector();
 c.record(e('signed','sign',200,999));
 for(const ms of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20])
  c.record(e('signed','get',206,ms));
 const s=c.summary().signed;
 assert.equal(s.latencyMs.p50,10);
 assert.equal(s.latencyMs.p95,19);
 assert.equal(s.latencyMs.samples,20);
 assert.equal(percentile([],0.5),null);
});
test('invalid modes kinds HTTP status and negative values fail closed',()=>{
 for(const props of [
  e('other','get',200),e('signed','other',200),e('proxy','get',0),
  e('proxy','get',600),e('signed','get',200,-1),
  e('proxy','get',200,NaN),e('signed','get',200,Infinity),
  e('proxy','get',200,1,{bodyBytes:-1}),e('signed','get',200,1,{originBytes:1.3}),
  e('proxy','get',200,1,{cacheHit:'yes'}),
  e('signed','get',200,1,{rangeRequest:'true'})
 ])assert.throws(()=>collector().record(props));
});
test('unexpected bearer credentials and paths are never part of summary',()=>{
 const c=collector();
 c.record({...e('signed','get',206,3,{bodyBytes:5}),
  token:'should-not-appear',url:'https://fixture.invalid/?token=fake',
  authorization:'Bearer forbidden',path:'private-owner/customer.webp'});
 const encoded=JSON.stringify(c.summary());
 for(const secret of ['should-not-appear','token=fake','Bearer forbidden','customer.webp'])
  assert.equal(encoded.includes(secret),false);
});
test('summary returns independent copies, not mutable underlying event storage',()=>{
 const c=collector();c.record(e('proxy','get',206,5,{bodyBytes:1}));
 const a=c.summary();a.proxy.bodyBytes=12345;a.proxy.statuses[206]=88;
 const later=c.summary();
 assert.equal(later.proxy.bodyBytes,1);
 assert.equal(later.proxy.statuses[206],1);
});
