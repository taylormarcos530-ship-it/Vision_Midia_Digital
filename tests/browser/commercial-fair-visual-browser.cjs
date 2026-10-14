// Isolated Chromium homologation. Serves only allowlisted local laboratory fixtures.
// No production URL, no secrets, no deployment, no device/player/API connection.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');

const files=new Set([
 '/commercial-tv-fair-rotation-lab.html',
 '/commercial-tv-fair-rotation-ui.mjs',
 '/commercial-tv-fair-rotation-lab.mjs',
 '/supabase/functions/_shared/commercial.mjs'
]);
const mime=p=>p.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer((req,res)=>{
 const uri=new URL(req.url,'http://localhost');
 if(uri.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
 if(req.method!=='GET'||!files.has(uri.pathname)){
  res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');return;
 }
 try{
  const full=path.join(process.cwd(),uri.pathname.slice(1));
  res.writeHead(200,{'Content-Type':mime(uri.pathname),'Cache-Control':'no-store'});
  res.end(fs.readFileSync(full));
 }catch(e){
  res.writeHead(500,{'Content-Type':'text/plain'});res.end('Fixture unavailable');
 }
});
let browser,checks=0;
const verified=(condition,message)=>{assert.ok(condition,message);checks++};
const view=page=>page.evaluate(()=>({
 viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
 bodyWidth:document.body.scrollWidth,consoleWidth:document.documentElement.clientWidth
}));
async function openLab(browser,base,width=390,mobile=false){
 const context=await browser.newContext({viewport:{width,height:860},
  isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1});
 const page=await context.newPage();
 const errors=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
 page.on('request',req=>{if(!req.url().startsWith(base+'/'))external.push(req.url());});
 await page.route('**/*',route=>{
  if(route.request().url().startsWith(base+'/'))return route.continue();
  external.push(route.request().url());return route.abort();
 });
 await page.goto(base+'/commercial-tv-fair-rotation-lab.html',{waitUntil:'networkidle'});
 await page.locator('#fair-current').waitFor();
 await page.waitForFunction(()=>document.getElementById('fair-current').textContent.includes('Auto Center'));
 return {context,page,errors,external};
}
async function metric(page,id){return Number(await page.locator('#'+id).textContent());}
async function run(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const browserBin=process.env.VISION_TEST_CHROMIUM||'/usr/bin/chromium';
 browser=await chromium.launch({headless:true,executablePath:browserBin,args:['--no-sandbox','--disable-dev-shm-usage']});
 const shots=process.env.RUNNER_TEMP||'/tmp';
 try{
  // Real rendering across small phones, tablets and desktop (not device-level TV tests).
  for(const width of [320,390,768,1280]){
   const {context,page,errors,external}=await openLab(browser,base,width,width<=390);
   const dimensions=await view(page);
   verified(dimensions.documentWidth<=dimensions.consoleWidth+1,
    'horizontal overflow at '+width+': '+JSON.stringify(dimensions));
   verified(dimensions.bodyWidth<=dimensions.consoleWidth+1,'body overflow at '+width);
   verified(await page.locator('#fair-sequence li').count()===8,'initial item count at '+width);
   verified((await page.locator('#fair-queue').textContent()).includes('Publicidade C'),
    'expected awaiting advertiser at '+width);
   verified((await page.locator('#fair-base-count').textContent())==='0','zero initial point count');
   verified((await page.locator('#fair-ad-count').textContent())==='0','zero initial ad count');
   verified(errors.length===0,'browser errors at '+width+': '+errors.join(' | '));
   verified(external.length===0,'external requests at '+width+': '+external.join(' | '));
   if(width===390||width===1280)
    await page.screenshot({path:path.join(shots,'vision-fair-'+width+'.png'),fullPage:true});
   await context.close();
  }

  const {context,page,errors,external}=await openLab(browser,base,390,true);
  await page.locator('#fair-five').click();
  verified(await metric(page,'fair-base-count')===30,'five cycles complete 30 base media');
  verified(await metric(page,'fair-ad-count')===10,'five cycles complete 10 fictional ads');
  verified((await page.locator('#fair-round').textContent())==='6','now cycle 6');
  verified((await page.locator('#fair-advertisers tr td:last-child').allTextContents()).every(x=>x==='2'),
   'all five advertisers get exactly two completed placements');
  await page.locator('#fair-five').click();
  verified(await metric(page,'fair-base-count')===60,'ten cycles complete 60 base media');
  verified(await metric(page,'fair-ad-count')===20,'ten cycles complete 20 ads');
  verified((await page.locator('#fair-advertisers tr td:last-child').allTextContents()).every(x=>x==='4'),
   'fair 10-cycle distribution remains equal');

  await page.locator('#fair-reset').click();
  await page.locator('#fair-start').click();
  for(let i=0;i<3;i++)await page.locator('#fair-finish').click();
  verified((await page.locator('#fair-current').textContent()).includes('Loja do João'),
   'fourth item is the first advertiser');
  const adCount=await metric(page,'fair-ad-count');
  await page.locator('#fair-toggles input[value="ad-1"]').uncheck();
  verified(await metric(page,'fair-ad-count')===adCount,'deactivating current ad must not count it');
  verified((await page.locator('#fair-current').textContent()).includes('Freios'),
   'after disabling advertiser resume at fourth original item, not earlier');
  verified((await page.locator('#fair-sequence li.commercial').count())===0,
   'remaining commercial insertions cancelled on inventory change');
  verified((await page.locator('#fair-queue').textContent()).includes('Alteração pendente'),
   'pending inventory explicitly displayed');
  await page.locator('#fair-cycle').click();
  verified(await metric(page,'fair-base-count')===6,'all establishment media completed once');
  verified(await metric(page,'fair-ad-count')===0,'no ad credited after cancelled campaign');
  verified((await page.locator('#fair-current').textContent()).includes('Troca de óleo'),
   'next cycle starts with establishment media');
  verified((await page.locator('#fair-sequence li.commercial').count())===2,
   'new cycle includes current eligible advertisers');
  verified(!(await page.locator('#fair-sequence').textContent()).includes('Loja do João'),
   'disabled advertiser absent from new round');

  await page.locator('#fair-disconnect').click();
  verified(await page.locator('#fair-cycle').isDisabled(),'no advance while disconnected');
  await page.locator('#fair-reconnect').click();
  await page.locator('#fair-restart').click();
  verified(await metric(page,'fair-ad-count')===0,'restart/reconnect cause no phantom impression');
  await page.locator('#fair-cycle').click();
  verified(await metric(page,'fair-base-count')===12,'base playback continues after simulated interruption');
  verified(await metric(page,'fair-ad-count')===2,'only actual simulated completions counted');

  await page.locator('#fair-reset').click();
  await page.locator('#fair-start').click();
  for(let i=0;i<3;i++)await page.locator('#fair-finish').click();
  verified((await page.locator('#fair-current').textContent()).includes('Empresa B'),
   'first active advertiser after disabling A');
  const beforeError=await metric(page,'fair-ad-count');
  await page.locator('#fair-error').click();
  verified((await page.locator('#fair-state').textContent()).includes('bloqueados'),
   'commercial media error blocks further ads');
  verified(await metric(page,'fair-ad-count')===beforeError,'failed ad not counted');
  verified((await page.locator('#fair-sequence li.commercial').count())===0,
   'commercial error retains base playlist only');
  verified(await page.locator('#fair-revalidate').isEnabled(),
   'explicit revalidation available');
  await page.locator('#fair-revalidate').click();
  verified((await page.locator('#fair-sequence li.commercial').count())===0,
   'revalidation never injects ads mid-cycle');
  await page.locator('#fair-cycle').click();
  verified((await page.locator('#fair-sequence li.commercial').count())===2,
   'commercials available again only in new round');

  await page.locator('#fair-base-select').selectOption('0');
  verified((await page.locator('#fair-current').textContent())==='Aguardando playlist',
   'no playlist shows waiting state');
  verified(await page.locator('#fair-start').isDisabled(),'cannot start unassigned TV');
  verified(await page.locator('#fair-five').isDisabled(),'cannot fake round with no playlist');
  verified((await page.locator('#fair-sequence li.commercial').count())===0,
   'no ads can play without base playlist');
  verified(await metric(page,'fair-ad-count')===0,'base change resets fictitious counters only');

  verified(errors.length===0,'pageerrors: '+errors.join(' | '));
  verified(external.length===0,'external network request(s): '+external.join(' | '));
  await page.screenshot({path:path.join(shots,'vision-fair-mobile-after-controls.png'),fullPage:true});
  await context.close();
  console.log(JSON.stringify({result:'PASS',checks,viewports:[320,390,768,1280],
   browser:'Chromium',externalRequests:0,pageErrors:0,screenshots:3,
   note:'fixtures only; no production connection or deploy'}));
 }finally{
  await browser.close();
 }
}
run().catch(e=>{console.error(e.stack||e);process.exitCode=1;})
 .finally(()=>server.close());
