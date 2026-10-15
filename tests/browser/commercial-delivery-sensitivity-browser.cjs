// OFFLINE LAB ONLY. Real Chromium HTTP Range traffic on loopback and real FFmpeg MP4s.
// Cache state is artificially seeded to vary conditions; NOT a CDN performance test.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {performance}=require('node:perf_hooks');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright-core');
const {collector}=require('../fixtures/commercial-delivery-metrics.cjs');
const {RANGE_COUNTS,CACHE_FRACTIONS}=require('../fixtures/commercial-delivery-sensitivity.cjs');

const files=new Map();
const endpoint='/preview/synthetic.mp4';
const signedUrl='/signed'+endpoint+'?token=synthetic-only';
const proxyUrl='/proxy'+endpoint;
let state=null,server=null,browser=null,context=null,checks=0,authorized=true;
const rows=[];
const eq=(actual,expected,label)=>{assert.deepStrictEqual(actual,expected,label);checks++};
const ok=(truth,label)=>{assert.ok(truth,label);checks++};
function respond(res,status,body,headers={}){
 res.writeHead(status,{'Cache-Control':'private, no-store',
  'Referrer-Policy':'no-referrer',...headers});
 res.end(body);
}
function splitRanges(size,count){
 if(count>size)throw Error('The file is smaller than the requested count');
 const result=[];
 for(let i=0;i<count;i++){
  const start=Math.floor(i*size/count),end=Math.floor((i+1)*size/count)-1;
  result.push({start,end,header:'bytes='+start+'-'+end});
 }
 return result;
}
function prepare(profile,count,cacheTarget){
 const file=files.get(profile);
 const ranges=splitRanges(file.length,count);
 // Warmup is synthetic: seed an in-memory cache without network requests.
 // This simulates content delivered from prior CDN activity (not measured real hits).
 const warmCount=Math.floor(count*cacheTarget);
 const cache=new Set(ranges.slice(0,warmCount).map(r=>r.header));
 state={profile,file,ranges,metrics:collector(),cache,
  signedIssued:0,proxyAuthorized:true};
 return {fileSize:file.length,warmCount,ranges};
}
function record(mode,kind,status,started,{size=0,origin=0,hit=false,range=false}={}){
 state.metrics.record({mode,kind,status,bodyBytes:size,originBytes:origin,
  proxyOutboundBytes:mode==='proxy'?size:0,
  cacheHit:hit,rangeRequest:range,elapsedMs:performance.now()-started});
}
function handler(req,res){
 const uri=new URL(req.url,'http://127.0.0.1');
 if(uri.pathname==='/')return respond(res,200,'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body><h1>Laboratório Vision</h1></body></html>',{'Content-Type':'text/html'});
 const start=performance.now();
 if(req.method==='POST'&&uri.pathname==='/sign'){
  req.resume();
  const valid=authorized&&req.headers.authorization==='Bearer fixture-A';
  const status=valid?200:403;
  record('signed','sign',status,start);
  if(valid)state.signedIssued++;
  return respond(res,status,JSON.stringify(valid?{url:signedUrl}:{error:'denied'}),
   {'Content-Type':'application/json'});
 }
 const mode=uri.pathname==='/signed'+endpoint?'signed':
  uri.pathname==='/proxy'+endpoint?'proxy':null;
 if(!mode||req.method!=='GET')return respond(res,404,'No route');
 const isAllowed=mode==='signed'?uri.searchParams.get('token')==='synthetic-only':
  authorized&&req.headers.authorization==='Bearer fixture-A';
 const range=req.headers.range;
 if(!isAllowed){
  record(mode,'get',403,start,{range:!!range});
  return respond(res,403,'Denied');
 }
 const expected=state.ranges.find(r=>r.header===range);
 if(!expected){
  record(mode,'get',416,start,{range:true});
  return respond(res,416,'Invalid range',{
   'Content-Range':'bytes */'+state.file.length,'Accept-Ranges':'bytes'});
 }
 const bytes=state.file.subarray(expected.start,expected.end+1);
 const hit=mode==='signed'&&state.cache.has(range);
 record(mode,'get',206,start,{size:bytes.length,
  origin:hit?0:bytes.length,hit,range:true});
 return respond(res,206,bytes,{'Content-Type':'video/mp4',
  'Accept-Ranges':'bytes','Content-Length':String(bytes.length),
  'Content-Range':'bytes '+expected.start+'-'+expected.end+'/'+state.file.length,
  'X-Fixture-Cache':hit?'HIT':'MISS'});
}
async function requests(page,headers){
 return page.evaluate(async options=>{
  const sign=await fetch('/sign',{method:'POST',headers:{
   Authorization:'Bearer fixture-A'},cache:'no-store'});
  const payload=await sign.json();
  if(sign.status!==200)throw Error('Synthetic signature blocked');
  const sums={signed:0,proxy:0,signedHits:0,statuses:[]};
  for(const range of options.ranges){
   for(const mode of ['signed','proxy']){
    const response=await fetch(mode==='signed'?payload.url:options.proxy,{
     headers:{...(mode==='proxy'?{Authorization:'Bearer fixture-A'}:{}),
      Range:range.header},cache:'no-store'});
    const data=await response.arrayBuffer();
    if(response.status!==206)throw Error('Missing Range 206 from '+mode);
    const expected=range.end-range.start+1;
    if(data.byteLength!==expected)throw Error('Wrong range body length');
    if(mode==='signed'){sums.signed+=data.byteLength;
     if(response.headers.get('X-Fixture-Cache')==='HIT')sums.signedHits++;
    }else sums.proxy+=data.byteLength;
    sums.statuses.push(response.status);
   }
  }
  return sums;
 },{...headers,proxy:proxyUrl});
}
async function runMatrix(page){
 for(const profile of ['short','medium','long']){
  const size=files.get(profile).length;
  for(const count of RANGE_COUNTS){
   for(const fraction of CACHE_FRACTIONS){
    const prepared=prepare(profile,count,fraction);
    const fetched=await requests(page,prepared);
    const metrics=state.metrics.summary();
    const a=metrics.signed,b=metrics.proxy;
    eq(a.signRequests,1,'Each scenario signs once ('+profile+'/'+count+'/'+fraction+')');
    eq(a.mediaGetRequests,count,'Signed get count matches HTTP Range');
    eq(b.mediaGetRequests,count,'Proxy get count matches HTTP Range');
    eq(a.cacheHits,prepared.warmCount,'Cache hit count equals seeded ranges');
    eq(fetched.signedHits,prepared.warmCount,'Browser sees same seeded cache HIT');
    eq(a.bodyBytes,size,'Signed complete media is assembled across Ranges');
    eq(b.bodyBytes,size,'Proxy complete media is assembled across Ranges');
    eq(fetched.signed,size,'Chromium received signed bytes');
    eq(fetched.proxy,size,'Chromium received proxy bytes');
    eq(b.originBytes,size,'Uncached proxy reads origin on each request');
    eq(b.proxyOutboundBytes,size,'Proxy outbound includes every delivered byte');
    ok(a.originBytes<=b.originBytes,'Signed origin is at most un-cached proxy origin');
    const actualHit=(size-a.originBytes)/size;
    rows.push({
     profile,mp4Bytes:size,rangeGets:count,
     targetCachePct:Math.round(fraction*100),
     actualCachePct:Math.round(actualHit*10000)/100,
     signedOriginBytes:a.originBytes,
     proxyOriginBytes:b.originBytes,
     proxyOutboundBytes:b.proxyOutboundBytes,
     signedP50Ms:a.latencyMs.p50,proxyP50Ms:b.latencyMs.p50
    });
   }
  }
 }
 eq(rows.length,27,'Three real MP4 durations × 3 Range counts × 3 seeded cache targets');
 const lengths=['short','medium','long'].map(p=>files.get(p).length);
 ok(lengths[0]<lengths[1]&&lengths[1]<lengths[2],
  'Real H264 movie file sizes strictly increase');
 for(const p of ['short','medium','long']){
  for(const ranges of RANGE_COUNTS){
   const group=rows.filter(x=>x.profile===p&&x.rangeGets===ranges);
   ok(group[0].signedOriginBytes>=group[1].signedOriginBytes&&
    group[1].signedOriginBytes>=group[2].signedOriginBytes,
    'More seeded cache hits do not increase signed origin bytes');
   ok(group.every(x=>x.proxyOutboundBytes===group[0].proxyOutboundBytes),
    'Changing cache assumptions never removes proxy-to-browser bytes');
  }
 }
}
async function testErrorMetrics(page){
 prepare('medium',4,0.5);
 const first=await page.evaluate(async x=>{
  const res=await fetch(x,{headers:{Authorization:'Bearer fixture-A',
   Range:'bytes=999999999-999999999'},cache:'no-store'});
  return res.status;
 },proxyUrl);
 eq(first,416,'Invalid Range yields 416');
 authorized=false;
 const after=await page.evaluate(async x=>{
  const response=await fetch(x,{headers:{Authorization:'Bearer fixture-A',
   Range:'bytes=0-1023'},cache:'no-store'});
  return response.status;
 },proxyUrl);
 eq(after,403,'Revoked access yields 403 on next proxy request');
 const deniedSign=await page.evaluate(async()=>{
  const response=await fetch('/sign',{method:'POST',headers:{
   Authorization:'Bearer fixture-A'},cache:'no-store'});
  return response.status;
 });
 eq(deniedSign,403,'Revocation blocks new signed link requests');
 const stats=state.metrics.summary();
 eq(stats.proxy.errors416,1,'Safe metrics include 416 count');
 eq(stats.proxy.errors403,1,'Safe metrics include 403 count');
 eq(stats.signed.errors403,1,'Safe metrics include denied sign');
}
async function run(){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vision-sensitivity-'));
 const errors=[],external=[],consoleMessages=[];
 try{
  for(const [profile,duration] of [['short',1],['medium',3],['long',6]]){
   const file=path.join(tmp,profile+'.mp4');
   execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',
    '-f','lavfi','-i','testsrc2=size=320x180:rate=24',
    '-t',String(duration),'-an','-c:v','libx264','-preset','ultrafast',
    '-pix_fmt','yuv420p','-movflags','+faststart',file],{timeout:30000});
   const buf=fs.readFileSync(file);
   ok(buf.length>2048,'Genuine MP4 file for '+profile);
   eq(buf.subarray(4,8).toString('ascii'),'ftyp','MP4 has ftyp header');
   files.set(profile,buf);
  }
  server=http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,
   executablePath:process.env.VISION_TEST_CHROMIUM||'/usr/bin/chromium',
   args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>consoleMessages.push(m.text()));
  page.on('request',req=>{if(!req.url().startsWith(base+'/'))external.push(req.url())});
  await page.route('**/*',route=>route.request().url().startsWith(base+'/')?
   route.continue():route.abort());
  await page.goto(base+'/',{waitUntil:'load'});
  await runMatrix(page);
  await testErrorMetrics(page);
  eq(errors,[],'No browser runtime errors');
  eq(external,[],'No off-loopback HTTP');
  ok(!consoleMessages.join('\n').includes('synthetic-only'),
   'No signed fixture token logged in browser console');
  ok(!JSON.stringify(rows).includes('token='),'Only aggregate data exported');
  // Output is JSON designed for checkpoint docs; no token, paths or URLs.
  console.log(JSON.stringify({result:'PASS',checks,
   model:'3 genuine H264 files x 3 range counts x 3 artificially seeded cache fractions',
   medium:'localhost Chromium; no real CDN or external Storage',
   summary:rows,latencyCaution:'p50 collected on local process; no WAN/production speed inference'}));
 }finally{
  if(context)await context.close();
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(tmp,{recursive:true,force:true});
 }
}
run().catch(e=>{console.error('Isolated sensitivity matrix failed:',e.message);process.exitCode=1});
