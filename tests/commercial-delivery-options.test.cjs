// LAB ONLY: arithmetic and decision contract for commercial preview delivery options.
// Synthetic assumptions. Not an invoice, real benchmark, RLS policy or production API.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const GB=1_000_000_000;
function numberInRange(n,min,max,name){
 if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)
  throw new RangeError('Invalid '+name);
 return n;
}
function estimate({
 previews,bytesPerPreview,rangesPerPreview=1,cdnCachedByteFraction=0,
 proxyUpstreamCachedByteFraction=0
}){
 numberInRange(previews,1,1_000_000_000,'previews');
 numberInRange(bytesPerPreview,1,1_000_000_000_000,'bytesPerPreview');
 numberInRange(rangesPerPreview,1,128,'rangesPerPreview');
 numberInRange(cdnCachedByteFraction,0,1,'cdnCachedByteFraction');
 numberInRange(proxyUpstreamCachedByteFraction,0,1,'proxyUpstreamCachedByteFraction');
 if(!Number.isInteger(previews)||!Number.isInteger(bytesPerPreview)||
  !Number.isInteger(rangesPerPreview))throw new RangeError('Whole numbers required');
 const bytes=previews*bytesPerPreview;
 const ranges=previews*rangesPerPreview;
 if(!Number.isSafeInteger(bytes)||!Number.isSafeInteger(ranges))
  throw new RangeError('Totals exceed exact safe integer arithmetic');
 return {
  input:{previews,bytesPerPreview,rangesPerPreview,cdnCachedByteFraction,
   proxyUpstreamCachedByteFraction},
  signed:{
   signingOperations:previews,mediaGetRequests:ranges,
   authorizationAtDownloadPerRequest:false,
   originBytes:bytes*(1-cdnCachedByteFraction),
   cachedBytes:bytes*cdnCachedByteFraction,
   clientBytes:bytes,
   deliveryPath:'Storage/CDN -> browser',
   mode:'signed-bearer'
  },
  proxy:{
   signingOperations:0,mediaGetRequests:ranges,authorizationChecks:ranges,
   storageUpstreamBytes:bytes,storageOriginBytes:bytes*(1-proxyUpstreamCachedByteFraction),
   storageCachedBytes:bytes*proxyUpstreamCachedByteFraction,
   proxyOutboundBytes:bytes,
   transportBytesIfEachHopCounted:bytes*2,
   deliveryPath:'Storage/CDN -> proxy -> browser',
   mode:'per-request-authorization'
  }
 };
}
function priceEstimate(model,rates){
 const names=['storageOriginUsdPerGB','storageCachedUsdPerGB','proxyOutboundUsdPerGB',
  'proxyRequestUsd','signedSigningUsd'];
 for(const key of names)numberInRange(rates[key],0,1000,key);
 const signedStorage=(model.signed.originBytes/GB)*rates.storageOriginUsdPerGB+
  (model.signed.cachedBytes/GB)*rates.storageCachedUsdPerGB;
 const proxyStorage=(model.proxy.storageOriginBytes/GB)*rates.storageOriginUsdPerGB+
  (model.proxy.storageCachedBytes/GB)*rates.storageCachedUsdPerGB;
 return {
  // Illustrative gross variable costs, excludes free quotas, bundling, taxes,
  // function execution time, database access, request overhead and the actual contract.
  signedUsd:signedStorage+model.signed.signingOperations*rates.signedSigningUsd,
  proxyUsd:proxyStorage+
   (model.proxy.proxyOutboundBytes/GB)*rates.proxyOutboundUsdPerGB+
   model.proxy.authorizationChecks*rates.proxyRequestUsd
 };
}
function firstByteDelayAssumption({signMs=0,storageMissMs,storageHitMs=0,
 cachedFraction=0,proxyAuthMs=0,proxyHopMs=0}){
 for(const [key,val] of Object.entries({signMs,storageMissMs,storageHitMs,
  cachedFraction,proxyAuthMs,proxyHopMs}))
  numberInRange(val,0,key==='cachedFraction'?1:1e6,key);
 return {
  signedMs:signMs+cachedFraction*storageHitMs+(1-cachedFraction)*storageMissMs,
  proxyMs:storageMissMs+proxyAuthMs+proxyHopMs,
  measured:false,
  note:'Assumptions only; no latency instrumentation or tested WebView/network'
 };
}
function accessDecision(mode,{
 alreadySigned=false,tokenUnexpired=false,cacheContainsBody=false,
  sessionAuthorized=false,bytesAlreadyReceived=false
}={}){
 if(mode!=='signed'&&mode!=='proxy')throw new Error('Unknown policy');
 // Access to copies already possessed is outside the server's control.
 if(bytesAlreadyReceived)return 'already-received';
 if(mode==='signed'&&(cacheContainsBody||(alreadySigned&&tokenUnexpired)))
  return 'still-available';
 return sessionAuthorized?'new-read-authorized':'new-read-denied';
}
function gate({immediateNewTransferStop,acceptsResidualSignedAccess,
 privateCommercialCopies,serverAuthorizesEachRead,hasOldWebViews,
 nativeVideoAuthCompatible,productionSqlRedactionApproved}){
 const missing=[];
 if(!privateCommercialCopies)missing.push('commercial-copies-must-be-isolated');
 if(!productionSqlRedactionApproved)missing.push('source-column-redaction-not-homologated');
 if(immediateNewTransferStop&&!serverAuthorizesEachRead)
  missing.push('server-auth-for-every-get-and-range-not-implemented');
 if(immediateNewTransferStop&&hasOldWebViews&&!nativeVideoAuthCompatible)
  missing.push('native-video-credentials-not-validated-on-old-webview');
 let provisionalMode='undecided';
 if(!immediateNewTransferStop&&acceptsResidualSignedAccess)
  provisionalMode='signed-url-candidate';
 if(immediateNewTransferStop)provisionalMode='authenticated-delivery-candidate';
 return {provisionalMode,canActivate:false,blockingConditions:missing,
  reason:'No real identity, storage/RLS, CDN, costs or target Android WebView verified'};
}
test('scenario counts direct and proxy bandwidth separately, without claiming prices',()=>{
 const z=estimate({previews:10000,bytesPerPreview:6_000_000,
  rangesPerPreview:4,cdnCachedByteFraction:0.2});
 assert.equal(z.signed.clientBytes,60_000_000_000);
 assert.equal(z.signed.originBytes,48_000_000_000);
 assert.equal(z.signed.cachedBytes,12_000_000_000);
 assert.equal(z.signed.signingOperations,10000);
 assert.equal(z.signed.mediaGetRequests,40000);
 assert.equal(z.proxy.authorizationChecks,40000);
 assert.equal(z.proxy.storageUpstreamBytes,60_000_000_000);
 assert.equal(z.proxy.proxyOutboundBytes,60_000_000_000);
 assert.equal(z.proxy.transportBytesIfEachHopCounted,120_000_000_000);
});
test('one media range per preview means one proxy authorization per request',()=>{
 const z=estimate({previews:5,bytesPerPreview:500000,rangesPerPreview:1});
 assert.equal(z.proxy.authorizationChecks,5);
 assert.equal(z.signed.signingOperations,5);
 assert.equal(z.proxy.proxyOutboundBytes,z.signed.clientBytes);
});
test('each video range adds authorization work, not payload duplication by itself',()=>{
 const a=estimate({previews:100,bytesPerPreview:4_000_000,rangesPerPreview:1});
 const b=estimate({previews:100,bytesPerPreview:4_000_000,rangesPerPreview:8});
 assert.equal(b.proxy.authorizationChecks,a.proxy.authorizationChecks*8);
 assert.equal(a.proxy.proxyOutboundBytes,b.proxy.proxyOutboundBytes);
});
test('signed cache hit percentage changes upstream traffic, not user-facing payload',()=>{
 const cold=estimate({previews:20,bytesPerPreview:1_000_000,cdnCachedByteFraction:0});
 const warm=estimate({previews:20,bytesPerPreview:1_000_000,cdnCachedByteFraction:1});
 assert.equal(cold.signed.originBytes,20_000_000);
 assert.equal(warm.signed.originBytes,0);
 assert.equal(warm.signed.cachedBytes,20_000_000);
 assert.equal(cold.signed.clientBytes,warm.signed.clientBytes);
});
test('proxy storage cache fraction, if present, does not remove the proxy outbound leg',()=>{
 const cold=estimate({previews:5,bytesPerPreview:500000,proxyUpstreamCachedByteFraction:0});
 const warm=estimate({previews:5,bytesPerPreview:500000,proxyUpstreamCachedByteFraction:1});
 assert.equal(warm.proxy.storageOriginBytes,0);
 assert.equal(warm.proxy.storageCachedBytes,2_500_000);
 assert.equal(warm.proxy.proxyOutboundBytes,cold.proxy.proxyOutboundBytes);
});
test('invalid or inaccurate scenario inputs are rejected, never silently rounded',()=>{
 for(const input of [
  {previews:0,bytesPerPreview:1}, {previews:-2,bytesPerPreview:1},
  {previews:1.5,bytesPerPreview:100}, {previews:1,bytesPerPreview:0},
  {previews:1,bytesPerPreview:Infinity},
  {previews:1,bytesPerPreview:100,cdnCachedByteFraction:1.5},
  {previews:1,bytesPerPreview:100,rangesPerPreview:0},
  {previews:1,bytesPerPreview:100,rangesPerPreview:1.3},
  {previews:1_000_000_000,bytesPerPreview:1_000_000_000_000}
 ])assert.throws(()=>estimate(input),RangeError);
});
test('rates must be explicitly passed: estimates do not masquerade as vendor bills',()=>{
 const model=estimate({previews:1000,bytesPerPreview:1_000_000});
 assert.throws(()=>priceEstimate(model,{}),RangeError);
 assert.throws(()=>priceEstimate(model,{storageOriginUsdPerGB:0.1,
  storageCachedUsdPerGB:0,proxyOutboundUsdPerGB:-0.5,proxyRequestUsd:0,
  signedSigningUsd:0}),RangeError);
});
test('transparent hypothetical pricing: no quotas or actual Supabase invoice assumed',()=>{
 const model=estimate({previews:1000,bytesPerPreview:1_000_000,
  cdnCachedByteFraction:0.5});
 const quote=priceEstimate(model,{
  storageOriginUsdPerGB:0.1,storageCachedUsdPerGB:0.03,
  proxyOutboundUsdPerGB:0.2,proxyRequestUsd:0.0001,signedSigningUsd:0.00001
 });
 // All unit rates are deliberately user-supplied fixtures in USD, NOT vendor prices.
 assert.equal(Math.round(quote.signedUsd*1000),75);
 assert.equal(Math.round(quote.proxyUsd*1000),400);
});
test('signed URL issued before revocation may remain valid while token lives',()=>{
 assert.equal(accessDecision('signed',{alreadySigned:true,tokenUnexpired:true,
  sessionAuthorized:false}),'still-available');
});
test('signed URL expires at origin but a previously cached body can still be read',()=>{
 assert.equal(accessDecision('signed',{alreadySigned:true,tokenUnexpired:false,
  cacheContainsBody:false,sessionAuthorized:false}),'new-read-denied');
 assert.equal(accessDecision('signed',{alreadySigned:true,tokenUnexpired:false,
  cacheContainsBody:true,sessionAuthorized:false}),'still-available');
});
test('per-request-auth proxy denies new transfers promptly after revocation',()=>{
 assert.equal(accessDecision('proxy',{sessionAuthorized:false,
  alreadySigned:true,tokenUnexpired:true}),'new-read-denied');
 assert.equal(accessDecision('proxy',{sessionAuthorized:true}),'new-read-authorized');
});
test('no strategy can retroactively withdraw video bytes already received',()=>{
 for(const mode of ['signed','proxy'])
  assert.equal(accessDecision(mode,{sessionAuthorized:false,
   bytesAlreadyReceived:true}),'already-received');
});
test('without immediate revocation signed URLs are only a provisional candidate',()=>{
 const r=gate({immediateNewTransferStop:false,acceptsResidualSignedAccess:true,
  privateCommercialCopies:true,serverAuthorizesEachRead:false,
  hasOldWebViews:true,nativeVideoAuthCompatible:false,
  productionSqlRedactionApproved:false});
 assert.equal(r.provisionalMode,'signed-url-candidate');
 assert.equal(r.canActivate,false);
 assert.ok(r.blockingConditions.includes('source-column-redaction-not-homologated'));
});
test('immediate-revocation constraint shifts candidate to a proxy, with extra gates',()=>{
 const r=gate({immediateNewTransferStop:true,acceptsResidualSignedAccess:false,
  privateCommercialCopies:true,serverAuthorizesEachRead:false,
  hasOldWebViews:true,nativeVideoAuthCompatible:false,
  productionSqlRedactionApproved:false});
 assert.equal(r.provisionalMode,'authenticated-delivery-candidate');
 assert.equal(r.canActivate,false);
 assert.ok(r.blockingConditions.includes('server-auth-for-every-get-and-range-not-implemented'));
 assert.ok(r.blockingConditions.includes('native-video-credentials-not-validated-on-old-webview'));
});
test('all-green synthetic inputs still require real staging approval before activation',()=>{
 const r=gate({immediateNewTransferStop:true,acceptsResidualSignedAccess:false,
  privateCommercialCopies:true,serverAuthorizesEachRead:true,
  hasOldWebViews:false,nativeVideoAuthCompatible:true,
  productionSqlRedactionApproved:true});
 assert.equal(r.canActivate,false);
 assert.deepEqual(r.blockingConditions,[]);
});
test('no measured latency claims: assumptions are declared and sensitivity is explicit',()=>{
 const fast=firstByteDelayAssumption({signMs:5,storageMissMs:90,storageHitMs:15,
  cachedFraction:0.75,proxyAuthMs:25,proxyHopMs:15});
 assert.equal(fast.measured,false);
 assert.equal(fast.signedMs,38.75);
 assert.equal(fast.proxyMs,130);
 assert.match(fast.note,/Assumptions only/);
});
test('existing portal signs copies briefly; range and revocation evidence are in test files only',()=>{
 const ui=fs.readFileSync('commercial-ui.mjs','utf8');
 const sql=fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8');
 const proxy=fs.readFileSync('tests/browser/commercial-video-range-revocation-browser.cjs','utf8');
 assert.match(ui,/expiresIn:60/);
 assert.match(proxy,/private, no-store/);
 assert.match(proxy,/status:403/);
 assert.doesNotMatch(sql,/commercial-delivery-options/);
 assert.doesNotMatch(fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8'),
  /commercial-delivery-options/);
});
