// OBSERVABILITY LAB ONLY. Chromium actual local HTTP traffic and genuine FFmpeg MP4.
// Measures synthetic signed URL vs synthetic authenticated proxy, no remote network.
// No production credentials, data, Storage, player, TV device, migration or deploy.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {chromium}=require('playwright-core');
const {collector}=require('../fixtures/commercial-delivery-metrics.cjs');

const object='commercial-ads/00000000-0000-4000-8000-000000000301.mp4';
const bObject='commercial-ads/00000000-0000-4000-8000-000000000302.mp4';
const signedMedia='/signed/vision-media/'+object;
const proxyMedia='/proxy/vision-media/'+object;
const bMedia='/proxy/vision-media/'+bObject;
const metrics=collector();
const cache=new Map();
const marks=[];
let video=null,server=null,browser=null,context=null,checks=0;
let clock=1_000_000,accessA=true,issued=null;
const eq=(x,y,label)=>{assert.deepStrictEqual(x,y,label);checks++};
const ok=(v,label)=>{assert.ok(v,label);checks++};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const allow=req=>{
 const h=req.headers.authorization;
 return h==='Bearer local-A'?'A':h==='Bearer local-B'?'B':null;
};
function respond(res,status,content,headers={}){
 res.writeHead(status,{
  'Cache-Control':'private, no-store',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
  ...headers
 });
 res.end(content);
}
function bounds(raw){
 if(raw===undefined)return {status:200,start:0,end:video.length-1,isRange:false};
 const m=/^bytes=(\d+)-(\d*)$/.exec(raw);
 if(!m)return {status:416,isRange:true};
 const start=Number(m[1]),end=m[2]?Number(m[2]):video.length-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
  start<0||end<start||end>=video.length)return {status:416,isRange:true};
 return {status:206,start,end,isRange:true};
}
function bodyFor(range){
 return video.subarray(range.start,range.end+1);
}
function record({mode,kind,status,bytes=0,origin=0,outbound=0,hit=false,range=false,started}){
 metrics.record({mode,kind,status,bodyBytes:bytes,originBytes:origin,
  proxyOutboundBytes:outbound,cacheHit:hit,rangeRequest:range,
  elapsedMs:performance.now()-started});
}
async function serve(req,res){
 const url=new URL(req.url,'http://127.0.0.1');
 if(req.method==='GET'&&url.pathname==='/'){
  return respond(res,200,'<!doctype html><html lang="pt-BR"><meta charset="utf-8">'+
   '<meta name="referrer" content="no-referrer"><body><main id="app">'+
   '<h1>Banco de teste Vision — métricas sintéticas</h1></main></body></html>',
   {'Content-Type':'text/html; charset=utf-8'});
 }
 const started=performance.now();
 if(req.method==='POST'&&url.pathname==='/signed/issue'){
  await sleep(3);
  const allowed=accessA&&allow(req)==='A';
  let status=200,body;
  if(allowed){
   issued={token:'synthetic-never-log-'+Math.random().toString(36).slice(2),
    expires:clock+60};
   body=JSON.stringify({url:signedMedia+'?token='+issued.token,expiresIn:60});
  }else{
   status=403;body=JSON.stringify({error:'access_denied'});
  }
  record({mode:'signed',kind:'sign',status,started});
  return respond(res,status,body,{'Content-Type':'application/json'});
 }
 if(req.method!=='GET')return respond(res,405,'Method not allowed');
 const signed=url.pathname===signedMedia;
 const proxy=url.pathname===proxyMedia||url.pathname===bMedia;
 if(!signed&&!proxy)return respond(res,404,'Unknown path');
 const mode=signed?'signed':'proxy';
 const actor=allow(req);
 const authorized=signed?!!issued&&url.searchParams.size===1&&
  url.searchParams.get('token')===issued.token&&clock<issued.expires:
  (url.pathname===proxyMedia?actor==='A'&&accessA:actor==='B');
 const range=bounds(req.headers.range);
 const key=url.pathname+'|'+req.headers.range+'|'+(signed?issued?.token:'');
 if(!authorized){
  await sleep(2);
  record({mode,kind:'get',status:403,range:range.isRange,started});
  return respond(res,403,'Denied');
 }
 if(range.status===416){
  await sleep(2);
  record({mode,kind:'get',status:416,range:true,started});
  return respond(res,416,'Range not satisfiable',
   {'Content-Range':'bytes */'+video.length,'Accept-Ranges':'bytes'});
 }
 // Explicit fixture cache, NOT browser HTTP cache or real CDN. The proxy never
 // bypasses per-request authorization via a cache.
 const hit=signed&&cache.has(key);
 await sleep(hit?1:signed?5:8);
 const body=hit?cache.get(key):bodyFor(range);
 if(signed&&!hit)cache.set(key,body);
 const bytes=body.length;
 record({mode,kind:'get',status:range.status,bytes,
  origin:hit?0:bytes,outbound:signed?0:bytes,hit,range:range.isRange,started});
 const headers={
  'Content-Type':'video/mp4','Content-Length':String(bytes),
  'Accept-Ranges':'bytes','X-Lab-Cache':hit?'HIT':'MISS'
 };
 if(range.status===206)headers['Content-Range']='bytes '+range.start+'-'+range.end+'/'+video.length;
 respond(res,range.status,body,headers);
}
async function exercise(page){
 const basic=await page.evaluate(async({
  signedMedia,proxyMedia,bMedia,bObject
 })=>{
  const events=[];
  const start=performance.now();
  const execute=async(mode,path,range,auth)=>{
   const headers={};
   if(auth)headers.Authorization='Bearer '+auth;
   if(range)headers.Range=range;
   const begin=performance.now();
   const res=await fetch(path,{method:'GET',headers,cache:'no-store'});
   const content=new Uint8Array(await res.arrayBuffer());
   const result={
    mode,status:res.status,size:content.length,
    labHit:res.headers.get('X-Lab-Cache'),
    range:res.headers.get('Content-Range'),
    requestMs:Number((performance.now()-begin).toFixed(3))
   };
   events.push(result);
   return result;
  };
  const auth=async()=>fetch('/signed/issue',{
   method:'POST',headers:{Authorization:'Bearer local-A'},cache:'no-store'
  }).then(async r=>({status:r.status,body:await r.json()}));
  const issued=await auth();
  if(issued.status!==200)throw Error('Fixture refused initial signing');
  const ref=issued.body.url; // NEVER printed, included in telemetry or console.
  const first=await execute('signed',ref,'bytes=0-1023');
  const second=await execute('signed',ref,'bytes=1024-1535');
  const repeat=await execute('signed',ref,'bytes=0-1023');
  const invalid=await execute('signed',ref,'bytes=999999-9999999');
  const proxy1=await execute('proxy',proxyMedia,'bytes=0-1023','local-A');
  const proxy2=await execute('proxy',proxyMedia,'bytes=1024-1535','local-A');
  const proxyAgain=await execute('proxy',proxyMedia,'bytes=0-1023','local-A');
  const proxyInvalid=await execute('proxy',proxyMedia,'bytes=999999-9999999','local-A');
  // Controller changes are done by the local Node harness, not remotely.
  window.lab={execute,auth,ref,events};
  return {first,second,repeat,invalid,proxy1,proxy2,proxyAgain,proxyInvalid,
   eventCount:events.length,elapsedMs:performance.now()-start,
   signedUrlStoredOnlyInPageMemory:true};
 },{signedMedia,proxyMedia,bMedia,bObject});
 eq(basic.first.status,206,'signed: first MP4 Range 206');
 eq(basic.first.size,1024,'signed: first response bytes 1024');
 eq(basic.second.size,512,'signed: second Range bytes 512');
 eq(basic.repeat.status,206,'signed: repeated Range still 206');
 eq(basic.repeat.labHit,'HIT','synthetic cache records signed repeat');
 eq(basic.invalid.status,416,'signed: invalid range 416');
 eq(basic.proxy1.status,206,'proxy: first MP4 Range 206');
 eq(basic.proxy2.size,512,'proxy: second Range bytes 512');
 eq(basic.proxyAgain.labHit,'MISS','proxy: new authenticated range not served by shared cache');
 eq(basic.proxyInvalid.status,416,'proxy: invalid range 416');
 eq(basic.eventCount,8,'matching pre-revocation eight media operations');
 ok(basic.first.range?.startsWith('bytes 0-1023/'),'proper Range header');
 ok(basic.elapsedMs>=0,'browser elapsed time is observed, not inferred');
 return basic;
}
async function revoked(page){
 accessA=false; // A is disabled, B stays active.
 const result=await page.evaluate(async({proxyMedia,bMedia})=>{
  const {execute,auth,ref}=window.lab;
  const issued=await auth();
  const oldSigned=await execute('signed',ref,'bytes=2048-2559');
  const deniedProxy=await execute('proxy',proxyMedia,'bytes=2048-2559','local-A');
  const separate=await execute('proxy',bMedia,'bytes=0-511','local-B');
  return {newSigning:issued.status,oldSigned,deniedProxy,separate};
 },{proxyMedia,bMedia});
 eq(result.newSigning,403,'new signed URL emission stops after A revoked');
 eq(result.oldSigned.status,206,'already-issued signed link retains access within TTL');
 eq(result.oldSigned.size,512,'existing bearer can deliver later MP4 bytes');
 eq(result.deniedProxy.status,403,'proxy denies new media Range after revocation');
 eq(result.deniedProxy.size,6,'proxy serves only minimal error body, not video bytes');
 eq(result.separate.status,206,'B remains authorized after A revoked');
 eq(result.separate.size,512,'B can read only its own range');
 clock+=61;
 const expired=await page.evaluate(async()=>window.lab.execute(
  'signed',window.lab.ref,'bytes=3072-3583'));
 eq(expired.status,403,'expired signed URL denied by synthetic origin after 60 seconds');
 return result;
}
async function run(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'vision-measure-'));
 const pageErrors=[],external=[],consoleMessages=[];
 try{
  const target=path.join(folder,'fixture.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',
   '-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','2',
   '-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
   '-movflags','+faststart',target],{timeout:30000});
  video=fs.readFileSync(target);
  ok(video.length>4096,'real H264 fixture available for multiple byte ranges');
  eq(video.subarray(4,8).toString('ascii'),'ftyp','generated media has real MP4 box');
  server=http.createServer((req,res)=>{void serve(req,res).catch(()=>{
   if(!res.headersSent)respond(res,500,'Lab error');
   else res.end();
  })});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,
   executablePath:process.env.VISION_TEST_CHROMIUM||'/usr/bin/chromium',
   args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage();
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('console',m=>consoleMessages.push(m.text()));
  page.on('request',r=>{if(!r.url().startsWith(base+'/'))external.push(r.url())});
  await page.route('**/*',route=>
   route.request().url().startsWith(base+'/')?route.continue():route.abort());
  await page.goto(base+'/',{waitUntil:'load'});
  const initial=await exercise(page);
  await revoked(page);
  const report=metrics.summary();
  eq(report.signed.signRequests,2,'two signed-URL requests: allow then deny');
  eq(report.signed.mediaGetRequests,6,'six signed media GETs measured');
  eq(report.signed.cacheHits,1,'exactly one simulated signed cache hit');
  eq(report.signed.errors403,2,'new signing plus expired origin denied');
  eq(report.signed.errors416,1,'signed invalid range counted');
  eq(report.signed.bodyBytes,3072,'signed successful MP4 bytes accounted');
  eq(report.signed.originBytes,2048,'signed fixture cache saves one 1024B read');
  eq(report.proxy.signRequests,0,'proxy needs no independent bearer signing');
  eq(report.proxy.mediaGetRequests,6,'proxy GET/Range counts include B');
  eq(report.proxy.cacheHits,0,'proxy fixture reauthorizes every requested range');
  eq(report.proxy.errors403,1,'revoked proxy range denied');
  eq(report.proxy.errors416,1,'proxy invalid range counted');
  eq(report.proxy.bodyBytes,3072,'proxy delivered bytes for A and authorized B');
  eq(report.proxy.proxyOutboundBytes,3072,'proxy downstream bytes measured separately');
  eq(report.proxy.originBytes,3072,'upstream proxy bytes counted independently');
  ok(report.signed.latencyMs.samples===6&&report.proxy.latencyMs.samples===6,
   'p50 and p95 use GET samples only');
  ok(Number.isFinite(report.signed.latencyMs.p95)&&
    Number.isFinite(report.proxy.latencyMs.p95),'observed latency quantiles exist');
  eq(pageErrors,[],'no browser exceptions');
  eq(external,[],'no off-loopback traffic');
  const printed=consoleMessages.join('\n');
  ok(!printed.includes('synthetic-never-log-'),'no synthetic bearer printed to console');
  ok(!JSON.stringify(report).includes('synthetic-never-log-'),'safe aggregate excludes signed tokens');
  ok(!JSON.stringify(report).includes('local-A'),'safe aggregate excludes authentication details');
  ok(!JSON.stringify(report).includes(object),'safe aggregate excludes commercial object paths');
  console.log(JSON.stringify({result:'PASS',checks,
   labels:'synthetic local only, no real CDN nor vendor pricing',
   statuses:{signed:report.signed.statuses,proxy:report.proxy.statuses},
   summary:report,comparablePreRevocationOperations:initial.eventCount,
   measurement:'server-observed request duration p50/p95, not network RTT nor real-world SLA'}));
 }finally{
  if(context)await context.close();
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(folder,{recursive:true,force:true});
 }
}
run().catch(err=>{console.error('Isolated preview telemetry laboratory failed:',err.message);process.exitCode=1});
