// Chromium lab only: deliberate bearer URL and cache semantics, not Supabase behavior.
// Entire HTTP server runs on 127.0.0.1 with fictitious identity and media.
// No credential, customer data, bucket, service, migration, or deployment is touched.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const {chromium}=require('playwright-core');

const copy='commercial-ads/00000000-0000-4000-8000-000000000301.webp';
const copyB='commercial-ads/00000000-0000-4000-8000-000000000302.webp';
const original='private-owner/establishment-media.webp';
const prefix='/storage/v1/object/sign/vision-media/';
const photo='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">'+
 '<rect width="120" height="60" fill="#124"/><text y="30" x="8" fill="white">LAB ONLY</text></svg>';
const state={
 now:100000,activeA:true,activeB:true,nonce:0,issued:new Map(),
 audit:[],originReads:0,cacheRevalidations:0,newSignRequests:0,proxyReads:0
};
let checks=0,server,base,browser,context;
function check(value,message){assert.ok(value,message);checks++;}
function equal(a,b,message){assert.deepStrictEqual(a,b,message);checks++;}
function audit(event,status,object){state.audit.push({event,status,object});}
function send(res,status,body,headers={}){
 res.writeHead(status,{'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff',...headers});
 res.end(body);
}
const ownerOf=x=>x===copy?'A':x===copyB?'B':null;
const account=(req)=>req.headers.authorization==='Bearer lab-session-A'?'A':
 req.headers.authorization==='Bearer lab-session-B'?'B':null;
function allowed(actor,object){
 return (actor==='A'&&state.activeA||actor==='B'&&state.activeB)&&ownerOf(object)===actor;
}
function signedToken(object){
 const token='synthetic-only-'+(++state.nonce);
 state.issued.set(token,{object,expiresAt:state.now+60});
 return token;
}
async function handle(req,res){
 try{
  const uri=new URL(req.url,'http://127.0.0.1');
  const location=uri.pathname;
  if(req.method==='GET'&&location==='/'){
   return send(res,200,'<!doctype html><html><head><meta name="referrer" content="no-referrer"></head>'+
    '<body><main id="dashboard"><div data-revision="rev-a"></div></main></body></html>',
    {'Content-Type':'text/html; charset=utf-8'});
  }
  if(req.method==='GET'&&location==='/commercial-ui.mjs'){
   return send(res,200,fs.readFileSync('commercial-ui.mjs'),
    {'Content-Type':'text/javascript; charset=utf-8'});
  }
  if(location.startsWith(prefix)){
   const object=location.slice(prefix.length);
   if(req.method==='POST'){
    req.resume();
    state.newSignRequests++;
    const actor=account(req);
    if(!allowed(actor,object)){
     audit('sign_denied',403,object);
     return send(res,403,JSON.stringify({message:'advertiser_unavailable'}),
      {'Content-Type':'application/json'});
    }
    const token=signedToken(object);
    audit('sign_issued',200,object); // Do not log token, signed URL or query.
    return send(res,200,JSON.stringify({
     signedURL:'/object/sign/vision-media/'+object+'?token='+token
    }),{'Content-Type':'application/json'});
   }
   if(req.method==='GET'){
    state.originReads++;
    const token=uri.searchParams.get('token');
    const claims=state.issued.get(token);
    if(!claims||claims.object!==object||uri.searchParams.size!==1){
     audit('origin_denied',403,object);
     return send(res,403,'Denied');
    }
    if(state.now>=claims.expiresAt){
     audit('origin_expired',403,object);
     return send(res,403,'Expired');
    }
    audit('origin_accepted',200,object);
    // Deliberately longer than the token TTL: a cache-risk demonstration.
    return send(res,200,photo,{'Content-Type':'image/svg+xml',
      'Cache-Control':'public, max-age=180, immutable'});
   }
  }
  if(location.startsWith('/proxy/vision-media/')){
   state.proxyReads++;
   const object=location.slice('/proxy/vision-media/'.length);
   const actor=account(req);
   const authorized=allowed(actor,object);
   audit(authorized?'proxy_allowed':'proxy_denied',authorized?200:403,object);
   return send(res,authorized?200:403,authorized?photo:'Denied',
    {'Content-Type':authorized?'image/svg+xml':'text/plain',
     'Cache-Control':'private, no-store'});
  }
  audit('unknown_path',404,location);
  return send(res,404,'Not found');
 }catch(err){
  audit('handler_error',500,'lab');
  return send(res,500,'Lab handler error');
 }
}
async function labStep(page){
 const results=await page.evaluate(async()=>{
  window.VISION_COMMERCIAL_CONFIG={
   enabled:true,environment:'staging',supabaseUrl:location.origin,
   supabasePublishableKey:'synthetic-publishable-fixture'
  };
  const ui=await import('/commercial-ui.mjs');
  const api=new ui.CommercialAPI();
  api.save({access_token:'lab-session-A',refresh_token:'lab-refresh-A',expires_in:3600});
  window.fixtureApi=api;
  const data={revisions:[{id:'rev-a',name:'Cópia comercial fictícia',
   media_type:'image',storage_path:'commercial-ads/00000000-0000-4000-8000-000000000301.webp'}]};
  const root=document.querySelector('#dashboard');
  await ui.loadThumbnails(root,data,api);
  const el=root.querySelector('img');
  if(!el)throw new Error('Expected actual signed image on panel');
  await new Promise((resolve,reject)=>{
   if(el.complete&&el.naturalWidth>0)return resolve();
   el.addEventListener('load',resolve,{once:true});
   el.addEventListener('error',()=>reject(new Error('Synthetic media not decoded')),{once:true});
  });
  window.fixtureSignedURL=el.src; // Kept ONLY in page memory, never printed.
  const resp=await fetch(el.src,{cache:'default'});
  const cache=await caches.open('commercial-signed-lab-only');
  await cache.put(el.src,resp.clone());
  return {previewLoaded:el.naturalWidth>0,originalFetchStatus:resp.status,
   cacheStored:(await cache.match(el.src))?.status||null,
   sessionPresent:!!api.session(),cardCount:root.querySelectorAll('img').length};
 });
 check(results.previewLoaded,'Actual Chromium image preview decoded');
 equal(results.originalFetchStatus,200,'Issued bearer URL returns media before revocation');
 equal(results.cacheStored,200,'A local CacheStorage copy of signed media exists');
 check(results.sessionPresent,'Synthetic session was initially active');
 equal(results.cardCount,1,'Advertiser sees one allowed commercial media preview');
}
async function testRevocation(page){
 state.activeA=false;
 const blocked=await page.evaluate(async()=>{
  try{
   await window.fixtureApi.request('/storage/v1/object/sign/vision-media/'+
    'commercial-ads/00000000-0000-4000-8000-000000000301.webp',
    {body:{expiresIn:60}});
   return {blocked:false};
  }catch(err){return {blocked:err.status===403,status:err.status}}
 });
 check(blocked.blocked,'Revoked advertiser cannot sign a NEW media URL');
 equal(blocked.status,403,'New signature request denied by synthetic server');
 const b=await page.evaluate(async()=>{
  try{
   await window.fixtureApi.request('/storage/v1/object/sign/vision-media/'+
    'commercial-ads/00000000-0000-4000-8000-000000000302.webp',
    {body:{expiresIn:60}});
   return false;
  }catch(err){return err.status===403}
 });
 check(b,'Advertiser A cannot sign an object belonging to B');
 const originalDenied=await page.evaluate(async()=>{
  try{
   await window.fixtureApi.request('/storage/v1/object/sign/vision-media/'+
    'private-owner/establishment-media.webp',{body:{expiresIn:60}});
   return false;
  }catch(err){return err.status===403}
 });
 check(originalDenied,'Advertiser cannot sign original establishment media');
 const prior=await page.evaluate(async()=>{
  const signed=await fetch(window.fixtureSignedURL,{cache:'no-store'});
  const proxy=await fetch('/proxy/vision-media/'+
   'commercial-ads/00000000-0000-4000-8000-000000000301.webp',
   {headers:{Authorization:'Bearer lab-session-A'},cache:'no-store'});
  return {signed:signed.status,proxy:proxy.status,
   proxyCacheControl:proxy.headers.get('cache-control')};
 });
 equal(prior.signed,200,'Old bearer remains valid before expiry even after revocation');
 equal(prior.proxy,403,'A fresh authenticated proxy GET is denied immediately');
 equal(prior.proxyCacheControl,'private, no-store','Denied proxy response cannot be cached by shared proxies');
}
async function testExpiryAndCache(page){
 state.now+=61; // deterministic server clock; no real-time sleep for TTL.
 const priorOriginReads=state.originReads;
 const result=await page.evaluate(async()=>{
  const stored=await (await caches.open('commercial-signed-lab-only')).match(window.fixtureSignedURL);
  const cachedBody=stored?await stored.text():null;
  const origin=await fetch(window.fixtureSignedURL,{cache:'no-store'});
  const proxy=await fetch('/proxy/vision-media/'+
   'commercial-ads/00000000-0000-4000-8000-000000000301.webp',
   {cache:'no-store',headers:{Authorization:'Bearer lab-session-A'}});
  return {cachedStatus:stored?.status||null,cachedBodyHasFixture:cachedBody?.includes('LAB ONLY')||false,
   originStatus:origin.status,proxyStatus:proxy.status};
 });
 equal(result.cachedStatus,200,'Previously cached image still retrievable locally after URL expiry');
 check(result.cachedBodyHasFixture,'Cached data are actual media bytes from the initial fetch');
 equal(result.originStatus,403,'New origin fetch is denied after simulated signed token expiry');
 equal(result.proxyStatus,403,'New authenticated proxy fetch remains blocked');
 check(state.originReads>priorOriginReads,'Expired request actually reached synthetic origin');
 const hit=await page.evaluate(async()=>{
  const v=await fetch(window.fixtureSignedURL,{cache:'force-cache'});
  return {status:v.status,body:(await v.text()).includes('LAB ONLY')};
 });
 // CacheStorage is deterministic; HTTP cache is browser/version dependent.
 // Record its status without relying on it as the sole cache proof.
 check([200,403].includes(hit.status),'Chromium HTTP cache returns a defined HTTP status');
}
async function testNoTokenLeak(page,consoleMessages,pageErrors,external){
 equal(pageErrors,[],'No uncaught browser script errors');
 equal(external,[],'No requests outside the loopback fixture');
 const browserLogs=consoleMessages.join('\n');
 const serializedAudit=JSON.stringify(state.audit);
 check(!browserLogs.includes('synthetic-only-'),'Synthetic bearer never printed to browser console');
 check(!serializedAudit.includes('synthetic-only-'),'Synthetic bearer never printed to application audit log');
 check(!serializedAudit.includes('token='),'Raw signed URLs never persisted in audit records');
 check(!serializedAudit.includes('Bearer '),'Authorization header never persisted in audit records');
 const fixed=fs.readFileSync('commercial-ui.mjs','utf8');
 check(!/console\s*\.\s*(?:log|debug|info|warn|error)\s*\(/.test(fixed),
  'Current frontend module does not log URLs or payloads');
 check(state.audit.some(x=>x.event==='origin_expired'),'Audit has sanitized expiry status');
 check(state.audit.some(x=>x.event==='sign_denied'),'Audit has sanitized revoked-signing status');
 equal(state.issued.size,1,'Only a single legal signed token was issued');
}
async function run(){
 await new Promise(resolve=>{server=http.createServer(handle);server.listen(0,'127.0.0.1',resolve)});
 base='http://127.0.0.1:'+server.address().port;
 const consoleMessages=[],pageErrors=[],external=[];
 try{
  browser=await chromium.launch({headless:true,
   executablePath:process.env.VISION_TEST_CHROMIUM||'/usr/bin/chromium',
   args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage();
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('console',m=>consoleMessages.push(m.text()));
  page.on('request',r=>{if(!r.url().startsWith(base+'/'))external.push(r.url())});
  await page.goto(base+'/',{waitUntil:'load'});
  await labStep(page);
  await testRevocation(page);
  await testExpiryAndCache(page);
  await testNoTokenLeak(page,consoleMessages,pageErrors,external);
  console.log(JSON.stringify({result:'PASS',checks,environment:'loopback-only',
   signedBeforeExpiry:'200 despite revoked account',
   newSigningAfterRevocation:403,newProxyAfterRevocation:403,
   originAfterExpiry:403,previouslyCachedBodyAfterExpiry:200,
   notes:'Synthetic signed token and CacheStorage; Chromium HTTP cache variability not used as revocation proof; no Supabase'}));
 }finally{
  if(context)await context.close();
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
 }
}
run().catch(err=>{console.error('Local signed-media lab failed:',err.message);process.exitCode=1});
