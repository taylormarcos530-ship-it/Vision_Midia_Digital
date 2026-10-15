// REAL Chromium UI homologation with loopback-only synthetic assets and intercepted API.
// OFFLINE LAB ONLY. Never contacts Supabase, production URLs, or customer devices.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright-core');
const {execFileSync}=require('node:child_process');
let generatedMp4=null,mp4Directory=null,videoMode='valid';

const imgPath='commercial-ads/00000000-0000-4000-8000-000000000301.webp';
const videoPath='commercial-ads/00000000-0000-4000-8000-000000000302.mp4';
const privatePath='private-owner/customer-media-original.webp';
const allowed=new Set([
 '/anunciante.html','/commercial.css','/commercial-config.js',
 '/advertiser-portal.mjs','/commercial-ui.mjs',
 '/commercial-advertiser-demo.mjs','/commercial-advertiser-demo-ui.mjs'
]);
const imageUrl='/storage/v1/object/sign/vision-media/'+imgPath;
const videoUrl='/storage/v1/object/sign/vision-media/'+videoPath;
const safeSvg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#122840"/><circle cx="510" cy="90" r="85" fill="#ebba42"/><text x="50" y="165" font-size="36" font-family="sans-serif" fill="white">Propaganda fictícia</text><text x="50" y="225" font-size="24" font-family="sans-serif" fill="#ebba42">Cópia comercial permitida</text></svg>';
const assetMime=p=>p.endsWith('.html')?'text/html; charset=utf-8':
 p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(req.method!=='GET'){res.writeHead(404);res.end();return;}
 if(u.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
 if(u.pathname===imageUrl){
  res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store'});
  res.end(safeSvg);return;
 }
 if(u.pathname===videoUrl){
  if(videoMode==='missing'){res.writeHead(404,{'Cache-Control':'no-store'});res.end();return;}
  const content=videoMode==='corrupt'?Buffer.from('not a valid MP4 fixture'):generatedMp4;
  if(!content){res.writeHead(503);res.end('MP4 fixture was not generated');return;}
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
  let first=0,last=content.length-1,status=200;
  if(range){
   first=Number(range[1]);
   last=range[2]?Math.min(Number(range[2]),content.length-1):last;
   if(first>last||first>=content.length){
    res.writeHead(416,{'Content-Range':'bytes */'+content.length});res.end();return;
   }
   status=206;
  }
  res.writeHead(status,{
   'Content-Type':'video/mp4','Accept-Ranges':'bytes',
   'Content-Length':last-first+1,'Cache-Control':'no-store',
   ...(status===206?{'Content-Range':`bytes ${first}-${last}/${content.length}`}:{})
  });
  res.end(content.subarray(first,last+1));return;
 }
 if(!allowed.has(u.pathname)){res.writeHead(404);res.end('No fixture');return;}
 try{
  const name=path.join(process.cwd(),u.pathname.slice(1));
  res.writeHead(200,{'Content-Type':assetMime(u.pathname),'Cache-Control':'no-store'});
  res.end(fs.readFileSync(name));
 }catch(err){res.writeHead(500);res.end('Local fixture unavailable');}
});
const payload=()=>({
 advertiser:{id:'advertiser-fixture',name:'Anunciante de laboratório',email:'teste@example.invalid'},
 today:'2026-10-14',
 campaigns:[
  {id:'image-ad',name:'Campanha de imagem',current_revision_id:'r-image',
   status:'active',start_date:'2026-10-01',end_date:'2026-10-31'},
  {id:'video-ad',name:'Campanha de vídeo',current_revision_id:'r-video',
   status:'active',start_date:'2026-10-01',end_date:'2026-10-31'},
  {id:'forbidden-ad',name:'Campanha sem prévia',current_revision_id:'r-private',
   status:'active',start_date:'2026-10-01',end_date:'2026-10-31'}
 ],
 revisions:[
  {id:'r-image',campaign_id:'image-ad',name:'Imagem fictícia',
   media_type:'image',storage_path:imgPath},
  {id:'r-video',campaign_id:'video-ad',name:'Vídeo fictício',
   media_type:'video',storage_path:videoPath},
  {id:'r-private',campaign_id:'forbidden-ad',name:'Sem arquivo autorizado',
   media_type:'image',storage_path:privatePath}
 ],
 targets:['image-ad','video-ad','forbidden-ad'].map(campaign_id=>({
  campaign_id,device_id:'tv-fixture',point_name:'Ponto de teste',
  device_name:'TV fictícia',active:true,online:false,last_seen_at:null
 })),
 daily:[{campaign_id:'image-ad',device_id:'tv-fixture',day:'2026-10-14',
  completed_count:2,attempt_count:3,last_completed_at:'2026-10-14T14:00:00Z'}]
});
let checks=0;
function ok(condition,description){assert.ok(condition,description);checks++;}
function eq(actual,expected,description){assert.deepEqual(actual,expected,description);checks++;}
async function login(page){
 await page.locator('#login-form [name=email]').fill('fixture@example.invalid');
 await page.locator('#login-form [name=password]').fill('synthetic-only-password');
 await page.locator('#login-form button').click();
 await page.locator('#dashboard:not([hidden])').waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.campaign').length===3);
}
async function open(browser,base,width,mode='ok'){
 const context=await browser.newContext({viewport:{width,height:860},
  hasTouch:width<=390,isMobile:width<=390,deviceScaleFactor:width<=390?2:1});
 const page=await context.newPage();
 const pageErrors=[],external=[],signed=[];
 let rpcMode='ok',storageMode=mode;
 page.on('pageerror',e=>pageErrors.push(e.message));
 page.on('request',req=>{if(!req.url().startsWith(base+'/'))external.push(req.url());});
 await page.route('**/*',route=>{
  if(!route.request().url().startsWith(base+'/')){
   external.push(route.request().url());return route.abort();
  }
  return route.continue();
 });
 await page.route('**/commercial-config.js',route=>route.fulfill({
  status:200,contentType:'text/javascript',
  body:'window.VISION_COMMERCIAL_CONFIG={enabled:true,environment:"staging",supabaseUrl:"'+
   base+'/fake",supabasePublishableKey:"fixture-public-key"};'
 }));
 await page.route('**/fake/**',route=>{
  const req=route.request(),name=new URL(req.url()).pathname;
  if(name==='/fake/auth/v1/token')return route.fulfill({
   json:{access_token:'fake-access',refresh_token:'fake-refresh',expires_in:3600}
  });
  if(name==='/fake/auth/v1/logout')return route.fulfill({json:{}});
  if(name==='/fake/rest/v1/rpc/vision_advertiser_portal'){
   if(rpcMode==='disabled')return route.fulfill({status:403,json:{message:'advertiser_unavailable'}});
   return route.fulfill({json:payload()});
  }
  if(name.startsWith('/fake/storage/v1/object/sign/vision-media/')){
   const file=name.slice('/fake/storage/v1/object/sign/vision-media/'.length);
   signed.push(file);
   if(storageMode==='deny')return route.fulfill({status:403,json:{message:'preview_denied'}});
   if(storageMode==='wrong-host')return route.fulfill({
    json:{signedURL:'https://unexpected.invalid/storage/v1/object/sign/vision-media/'+file+'?token=bad'}
   });
   return route.fulfill({json:{signedURL:'/object/sign/vision-media/'+file+'?token=local-fixture'}});
  }
  return route.fulfill({status:404,json:{message:'route_not_in_lab'}});
 });
 await page.goto(base+'/anunciante.html',{waitUntil:'networkidle'});
 return {context,page,pageErrors,external,signed,
  setRpcMode:v=>{rpcMode=v},setStorageMode:v=>{storageMode=v}};
}
async function baseline(browser,base,width,folder){
 const s=await open(browser,base,width);
 const {page}=s;
 try{
  await login(page);
  await page.locator('.creative img').waitFor();
  await page.locator('.creative video').waitFor();
  eq(await page.locator('.campaign').count(),3,'all campaign cards at '+width);
  eq(await page.locator('.creative img').count(),1,'one commercial image at '+width);
  eq(await page.locator('.creative video').count(),1,'one commercial video at '+width);
  eq(await page.locator('.creative[data-revision="r-private"] img').count(),0,
   'no forbidden customer image at '+width);
  eq(s.signed.slice().sort(),[imgPath,videoPath].sort(),'only safe copies requested at '+width);
  const metrics=await page.locator('.campaign').first().locator('.metrics strong').allTextContents();
  ok(metrics.includes('2'),'completed count shown at '+width);
  const dimensional=await page.evaluate(()=>({
   scroll:document.documentElement.scrollWidth,
   visible:document.documentElement.clientWidth,
   imgLoaded:document.querySelector('.creative img')?.naturalWidth||0,
   videoControls:document.querySelector('.creative video')?.controls===true
  }));
  ok(dimensional.scroll<=dimensional.visible+1,'no horizontal overflow at '+width+': '+JSON.stringify(dimensional));
  ok(dimensional.imgLoaded>0,'real fixture image rendered at '+width);
  ok(dimensional.videoControls,'video controls present at '+width);
  const source=await page.locator('#campaigns').innerHTML();
  ok(!source.includes(privatePath),'private original media path not rendered at '+width);
  eq(s.pageErrors,[],'no script exceptions at '+width);
  eq(s.external,[],'no outbound requests at '+width);
  if(width===390||width===1280){
   await page.screenshot({path:path.join(folder,'vision-commercial-portal-'+width+'.png'),fullPage:true});
  }
 }finally{await s.context.close();}
}
async function failures(browser,base){
 const s=await open(browser,base,390,'deny');
 const {page}=s;
 try{
  await login(page);
  await page.locator('.creative[data-revision="r-image"]').getByText('Prévia indisponível no momento.').waitFor();
  eq(await page.locator('.creative img').count(),0,'denied Storage shows no image');
  eq(await page.locator('.creative video').count(),0,'denied Storage shows no video');
  eq(s.signed.slice().sort(),[imgPath,videoPath].sort(),'denied requests remain narrowly scoped');
  ok(await page.locator('#dashboard').isVisible(),'campaigns survive storage failure');
  await s.page.screenshot({path:path.join(process.env.RUNNER_TEMP||os.tmpdir(),'vision-commercial-portal-denied.png'),fullPage:true});
  s.setStorageMode('wrong-host');
  await page.locator('#refresh').click();
  await page.waitForFunction(()=>document.querySelectorAll('.campaign').length===3);
  await page.waitForFunction(()=>document.querySelectorAll('.creative img,.creative video').length===0);
  // A foreign signed host is not inserted or requested by Chromium.
  await page.waitForFunction(()=>document.querySelectorAll('.creative img,.creative video').length===0);
  // Verify that the new RPC and both signing calls actually completed before
  // triggering the session revocation, rather than asserting stale DOM state.
  for(let i=0;i<200&&s.signed.length<4;i++)await new Promise(resolve=>setTimeout(resolve,25));
  eq(s.signed.length,4,'refresh attempted both copies with a rejected foreign signature');
  await page.waitForTimeout(100);
  eq(await page.locator('.creative img, .creative video').count(),0,
   'foreign signed URL is never rendered');
  eq(s.external,[],'no request to foreign signature host');
  s.setStorageMode('ok');
  s.setRpcMode('disabled');
  await page.locator('#refresh').click();
  await page.locator('#login:not([hidden])').waitFor();
  eq(await page.locator('#campaigns').textContent(),'','403 purges visible ad data');
  ok(!(await page.locator('#dashboard').isVisible()),'403 closes advertiser dashboard');
  eq(await page.evaluate(()=>sessionStorage.length),0,'staging session removed after advertiser revoked');
  eq(s.pageErrors,[],'no exceptions during revoked session');
 }finally{await s.context.close();}
}
async function logout(browser,base){
 const s=await open(browser,base,390);
 try{
  await login(s.page);
  await s.page.locator('#logout').click();
  await s.page.locator('#login:not([hidden])').waitFor();
  eq(await s.page.locator('#campaigns').textContent(),'','logout empties campaign data');
  eq(await s.page.evaluate(()=>sessionStorage.length),0,'logout clears session');
  eq(s.pageErrors,[],'no browser exception on logout');
 }finally{await s.context.close();}
}
async function verifyRealMp4(browser,base){
 videoMode='valid';
 const s=await open(browser,base,390);
 try{
  await login(s.page);
  await s.page.locator('.creative[data-revision="r-video"] video').waitFor();
  const decoded=await s.page.evaluate(async()=>{
   const video=document.querySelector('.creative[data-revision="r-video"] video');
   video.muted=true;
   video.preload='auto';
   const waitFor=(event,deadline=15000)=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Timed out waiting for '+event)),deadline);
    const onError=()=>{clearTimeout(timeout);reject(new Error('Video decode error '+video.error?.code));};
    video.addEventListener('error',onError,{once:true});
    video.addEventListener(event,()=>{clearTimeout(timeout);video.removeEventListener('error',onError);resolve();},{once:true});
   });
   if(video.readyState<1)await waitFor('loadedmetadata');
   const metadata={
    duration:video.duration,width:video.videoWidth,height:video.videoHeight,
    readyState:video.readyState
   };
   const ended=waitFor('ended');
   await video.play();
   await ended;
   return {...metadata,ended:video.ended,currentTime:video.currentTime};
  });
  ok(decoded.duration>1&&decoded.duration<3,'true video metadata contains expected 1.5s duration');
  eq([decoded.width,decoded.height],[320,180],'real MP4 decodes at expected dimensions');
  ok(decoded.readyState>=1,'Chromium reports loaded MP4 metadata');
  ok(decoded.ended,'Chromium reaches end of real MP4 playback');
  ok(decoded.currentTime>=1,'real MP4 playback advances past one second');
  eq(s.pageErrors,[],'no page exceptions during actual MP4 decode and playback');
  eq(s.external,[],'real MP4 served exclusively over loopback');
 }finally{await s.context.close();}
}
async function verifyBrokenMp4(browser,base,mode){
 videoMode=mode;
 const s=await open(browser,base,390);
 try{
  await login(s.page);
  const slot=s.page.locator('.creative[data-revision="r-video"]');
  await slot.getByText('Prévia indisponível no momento.').waitFor({timeout:15000});
  eq(await slot.locator('video').count(),0,'broken MP4 removed from preview: '+mode);
  ok(await s.page.locator('#dashboard').isVisible(),'dashboard survives '+mode+' MP4');
  ok(await s.page.locator('.campaign').count()===3,'campaign list preserved for '+mode);
  const metrics=await s.page.locator('.campaign').first().locator('.metrics strong').allTextContents();
  ok(metrics.includes('2'),'metrics survive '+mode+' MP4');
  eq(s.pageErrors,[],'no uncaught UI errors for '+mode+' MP4');
  eq(s.external,[],'no external requests for '+mode+' MP4');
 }finally{await s.context.close();videoMode='valid';}
}
async function run(){
 mp4Directory=fs.mkdtempSync(path.join(os.tmpdir(),'vision-commercial-mp4-'));
 const mp4File=path.join(mp4Directory,'fixture-commercial.mp4');
 execFileSync('ffmpeg',[
  '-hide_banner','-loglevel','error','-y','-f','lavfi',
  '-i','testsrc2=size=320x180:rate=24','-t','1.5',
  '-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
  '-movflags','+faststart',mp4File
 ],{timeout:30000});
 generatedMp4=fs.readFileSync(mp4File);
 ok(generatedMp4.length>1000,'nonempty real H264 MP4 fixture generated by ffmpeg');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch({headless:true,
   executablePath:process.env.VISION_TEST_CHROMIUM||'/usr/bin/chromium',
   args:['--no-sandbox','--disable-dev-shm-usage']});
  const folder=process.env.RUNNER_TEMP||os.tmpdir();
  for(const width of [320,390,768,1280])await baseline(browser,base,width,folder);
  await verifyRealMp4(browser,base);
  await verifyBrokenMp4(browser,base,'missing');
  await verifyBrokenMp4(browser,base,'corrupt');
  await failures(browser,base);
  await logout(browser,base);
  console.log(JSON.stringify({result:'PASS',checks,
   viewports:[320,390,768,1280],network:'loopback-only',
   mp4:'H264 real fixture decoded and ended in headless Chromium',
   recovery:'404 and corrupt MP4 both fall back without blocking dashboard',
   limitation:'synthetic Auth/Storage, no Android TV or Supabase real'}));
 }finally{
  if(browser)await browser.close();
  server.close();
  if(mp4Directory)fs.rmSync(mp4Directory,{recursive:true,force:true});
 }
}
run().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
