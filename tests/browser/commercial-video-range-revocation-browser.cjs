// OFFLINE TEST ONLY: synthetic video and authorization, local Chromium + ffmpeg.
// No Supabase, customer device, playlists, remote service, migration or deployment.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright-core');
const A='commercial-ads/00000000-0000-4000-8000-000000000301.mp4';
const B='commercial-ads/00000000-0000-4000-8000-000000000302.mp4';
const PREFIX='/commercial-proxy/vision-media/';
const originals='private-owner/original-tv.mp4';
const owners=new Map([[A,'A'],[B,'B']]);
const standardHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
const audit=[];
let file,revokedA=false,checks=0;
let server,browser,context;
const check=(x,message)=>{assert.ok(x,message);checks++};
const eq=(a,b,message)=>{assert.deepStrictEqual(a,b,message);checks++};
function respond(res,status,body,extras={}){
 res.writeHead(status,{...standardHeaders,...extras});
 res.end(body);
}
function endpoint(req,res){
 const url=new URL(req.url,'http://127.0.0.1');
 if(req.method==='GET'&&url.pathname==='/'){
  return respond(res,200,'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><body><main id="dashboard"><h1>Portal fictício</h1><div id="campaigns"></div><p id="status">Painel preservado</p></main></body></html>',
   {'Content-Type':'text/html; charset=utf-8'});
 }
 if(req.method==='GET'&&url.pathname==='/commercial-ui.mjs'){
  return respond(res,200,fs.readFileSync('commercial-ui.mjs'),{'Content-Type':'text/javascript; charset=utf-8'});
 }
 if(!url.pathname.startsWith(PREFIX))return respond(res,404,'Unknown route');
 const object=url.pathname.slice(PREFIX.length);
 const identity=req.headers.authorization==='Bearer laboratory-A'?'A':
  req.headers.authorization==='Bearer laboratory-B'?'B':null;
 if(!identity||owners.get(object)!==identity||(identity==='A'&&revokedA)){
  audit.push({status:403,event:'denied',identity:identity||'anonymous'});
  return respond(res,403,'Forbidden',{'Content-Type':'text/plain'});
 }
 if(req.method==='HEAD'){
  audit.push({status:200,event:'head'});
  return respond(res,200,'',{'Content-Length':String(file.length),'Content-Type':'video/mp4'});
 }
 if(req.method!=='GET')return respond(res,405,'Method not allowed');
 if(!req.headers.range){
  audit.push({status:200,event:'full',identity});
  return respond(res,200,file,{'Content-Type':'video/mp4','Content-Length':String(file.length)});
 }
 const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
 if(!m){
  audit.push({status:416,event:'malformed_range'});
  return respond(res,416,'Bad range',{'Content-Range':'bytes */'+file.length});
 }
 const from=Number(m[1]),to=m[2]?Number(m[2]):file.length-1;
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||to>=file.length){
  audit.push({status:416,event:'unsatisfiable_range'});
  return respond(res,416,'Bad range',{'Content-Range':'bytes */'+file.length});
 }
 const slice=file.subarray(from,to+1);
 audit.push({status:206,event:'partial',identity,start:from,end:to});
 return respond(res,206,slice,{
  'Content-Type':'video/mp4',
  'Content-Length':String(slice.length),
  'Content-Range':'bytes '+from+'-'+to+'/'+file.length
 });
}
async function scenario(page){
 const fake={today:'2026-10-14',
  campaigns:[{id:'ad-a',name:'Campanha fictícia A',current_revision_id:'rev-a',
   status:'active',start_date:'2026-10-01',end_date:'2026-10-31'}],
  revisions:[{id:'rev-a',name:'Comercial em vídeo',media_type:'video',storage_path:A}],
  targets:[{campaign_id:'ad-a',device_id:'tv-fixture',point_name:'Ponto fictício',
   device_name:'TV bancada',active:true,online:false,last_seen_at:null}],
  daily:[{campaign_id:'ad-a',device_id:'tv-fixture',day:'2026-10-14',
   completed_count:2,last_completed_at:'2026-10-14T14:00:00Z'}]};
 const rendered=await page.evaluate(async data=>{
  const ui=await import('/commercial-ui.mjs');
  document.getElementById('campaigns').innerHTML=ui.renderCampaigns(data);
  const cards=document.getElementById('campaigns');
  return {count:cards.querySelectorAll('.campaign').length,
   title:cards.textContent.includes('Campanha fictícia A'),
   metrics:cards.textContent.includes('2'),
   point:cards.textContent.includes('Ponto fictício')};
 },fake);
 eq(rendered.count,1,'Original campaign card renders');
 check(rendered.title&&rendered.metrics&&rendered.point,'Campaign, point and metrics display');
 const first=await page.evaluate(async url=>{
  const response=await fetch(url,{headers:{Authorization:'Bearer laboratory-A',
   Range:'bytes=0-1023'},cache:'no-store'});
  const payload=new Uint8Array(await response.arrayBuffer());
  return {status:response.status,contentRange:response.headers.get('Content-Range'),
   acceptRanges:response.headers.get('Accept-Ranges'),
   cache:response.headers.get('Cache-Control'),mime:response.headers.get('Content-Type'),
   bytes:payload.length,magic:String.fromCharCode(...payload.slice(4,8))};
 },PREFIX+A);
 eq(first.status,206,'Initial byte range served to authorized A');
 eq(first.bytes,1024,'Exactly requested first chunk served');
 eq(first.magic,'ftyp','First chunk belongs to genuine MP4');
 check(/^bytes 0-1023\/\d+$/.test(first.contentRange),'Correct Content-Range');
 eq(first.acceptRanges,'bytes','Server signals byte-range support');
 eq(first.mime,'video/mp4','Real H264 content-type retained');
 eq(first.cache,'private, no-store','Authorized segment cannot be shared cached');
 const played=await page.evaluate(async url=>{
  const video=document.createElement('video');
  video.muted=true;video.controls=true;video.playsInline=true;
  document.getElementById('campaigns').appendChild(video);
  const wait=name=>new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Timeout '+name)),16000);
   const failed=()=>{clearTimeout(timeout);reject(Error('Decode failed'))};
   video.addEventListener('error',failed,{once:true});
   video.addEventListener(name,()=>{clearTimeout(timeout);video.removeEventListener('error',failed);resolve()},{once:true});
  });
  video.src=url;
  if(video.readyState<1)await wait('loadedmetadata');
  const dims=[video.videoWidth,video.videoHeight],duration=video.duration;
  const ended=wait('ended');
  await video.play();
  await ended;
  return {dims,duration,ended:video.ended,currentTime:video.currentTime};
 },PREFIX+A);
 eq(played.dims,[320,180],'Chromium decodes genuine 320x180 H264 MP4');
 check(played.duration>1&&played.duration<4,'Duration is valid');
 check(played.ended&&played.currentTime>=1,'Playback ended successfully before revocation');
 revokedA=true;
 const result=await page.evaluate(async data=>{
  const get=async(object,auth,range)=>{
   const headers={Authorization:'Bearer laboratory-'+auth};
   if(range)headers.Range=range;
   const response=await fetch(data.prefix+object,{headers,cache:'no-store'});
   return {status:response.status,size:(await response.arrayBuffer()).byteLength,
    range:response.headers.get('Content-Range'),
    cache:response.headers.get('Cache-Control')};
  };
  return {
   next:await get(data.a,'A','bytes=1024-2047'),
   fresh:await get(data.a,'A',null),
   head:await fetch(data.prefix+data.a,{method:'HEAD',
    headers:{Authorization:'Bearer laboratory-A'},cache:'no-store'}).then(x=>x.status),
   other:await get(data.b,'B','bytes=0-511'),
   invalid:await get(data.b,'B','bytes=999999-9999999'),
   cross:await get(data.a,'B','bytes=0-511'),
   crossBack:await get(data.b,'A','bytes=0-511'),
   original:await get(data.original,'B','bytes=0-511'),
   anonymous:await get(data.a,'anonymous','bytes=0-511')};
 },{prefix:PREFIX,a:A,b:B,original:originals});
 eq(result.next.status,403,'Second range denied immediately after revocation');
 eq(result.next.range,null,'403 does not claim partial content');
 check(result.next.size<1024,'403 does not expose video segment');
 eq(result.next.cache,'private, no-store','403 reply cannot be shared cached');
 eq(result.fresh.status,403,'Revoked user denied full subsequent transfer');
 eq(result.head,403,'HEAD cannot bypass revocation');
 eq(result.other.status,206,'Unrelated advertiser B remains able to stream');
 eq(result.other.size,512,'Tenant B receives exactly its authorized segment');
 eq(result.invalid.status,416,'Unsatisfiable range rejected for active user');
 eq(result.cross.status,403,'B cannot stream A commercial copy');
 eq(result.crossBack.status,403,'A cannot stream B commercial copy');
 eq(result.original.status,403,'Establishment original not reachable via proxy');
 eq(result.anonymous.status,403,'Anonymous video request rejected');
 const view=await page.evaluate(()=>({
  campaigns:document.querySelectorAll('.campaign').length,
  title:document.getElementById('campaigns').textContent.includes('Campanha fictícia A'),
  videos:document.querySelectorAll('#dashboard video').length,
  status:document.getElementById('status').textContent
 }));
 eq(view.campaigns,1,'Denial leaves campaign card intact');
 check(view.title,'Denial leaves campaign information intact');
 eq(view.videos,1,'Existing video player remains mounted (buffer may remain)');
 eq(view.status,'Painel preservado','Other dashboard content preserved');
 check(audit.some(x=>x.event==='partial'&&x.identity==='A'&&x.start===0),
  'Initial accepted partial transfer was audited');
 check(audit.some(x=>x.event==='denied'&&x.identity==='A'),
  'Revocation denial was audited');
 check(audit.some(x=>x.event==='partial'&&x.identity==='B'),
  'Other tenant continuation was audited');
}
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-range-'));
 let errors=[],outside=[],messages=[];
 try{
  const movie=path.join(dir,'synthetic.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',
   '-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','2',
   '-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
   '-movflags','+faststart',movie],{timeout:30000});
  file=fs.readFileSync(movie);
  check(file.length>4096,'MP4 contains multiple segments');
  eq(file.subarray(4,8).toString('ascii'),'ftyp','Generated bytes are true MP4');
  server=http.createServer(endpoint);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,
   executablePath:process.env.VISION_TEST_CHROMIUM||'/usr/bin/chromium',
   args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>messages.push(m.text()));
  page.on('request',req=>{if(!req.url().startsWith(base+'/'))outside.push(req.url())});
  await page.route('**/commercial-proxy/vision-media/**',route=>{
   if(route.request().resourceType()!=='media')return route.continue();
   return route.continue({headers:{...route.request().headers(),
    authorization:'Bearer laboratory-A'}});
  });
  await page.goto(base+'/',{waitUntil:'load'});
  await scenario(page);
  eq(errors,[],'Zero uncaught browser errors');
  eq(outside,[],'No requests to any remote host');
  check(!JSON.stringify(audit).includes('Bearer '),'Server audit excludes Authorization headers');
  check(!JSON.stringify(audit).includes('token='),'Server audit excludes signed URLs');
  check(!messages.join('\n').includes('laboratory-A'),'Console omits synthetic Authorization');
  console.log(JSON.stringify({result:'PASS',checks,
   video:'actual H264 320x180',initialRange:206,subsequentRangeAfterRevocation:403,
   separateAdvertiserRange:206,server:'loopback authenticated fixture',
   note:'Playback completed before revocation; no claim of stopping buffered video or Supabase/CDN equivalence'}));
 }finally{
  if(context)await context.close();
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(dir,{recursive:true,force:true});
 }
}
run().catch(e=>{console.error('Local Range lab:',e.stack||e);process.exitCode=1});
