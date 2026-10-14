const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const STAGING='https://jmiuitrrhtaeyrpuyohk.supabase.co';
const PREVIEW='vision-midia-digital-opbernwbo-vision-5529.vercel.app';
function configFor(hostname){
 const window={};
 vm.runInNewContext(fs.readFileSync('commercial-staging-config.js','utf8'),{window,location:{hostname}});
 return window.VISION_COMMERCIAL_CONFIG;
}
const store=()=>{
 const values=new Map();
 return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),has:k=>values.has(k)};
};
async function withGlobals(f){
 const previous={window:global.window,sessionStorage:global.sessionStorage,localStorage:global.localStorage,fetch:global.fetch};
 const sessionStorage=store(),localStorage=store();
 global.window={VISION_COMMERCIAL_CONFIG:configFor(PREVIEW)};
 global.sessionStorage=sessionStorage;global.localStorage=localStorage;
 try {return await f({sessionStorage,localStorage})}
 finally {for(const [k,v] of Object.entries(previous)){if(v===undefined)delete global[k];else global[k]=v}}
}
test('only dedicated Vercel previews and localhost can enable staging Auth',()=>{
 const cfg=configFor(PREVIEW);
 assert.equal(cfg.enabled,true);
 assert.equal(cfg.environment,'staging');
 assert.equal(cfg.supabaseUrl,STAGING);
 assert.match(cfg.supabasePublishableKey,/^sb_publishable_/);
 assert.equal(configFor('visionmidiadigitalgo.netlify.app').enabled,false);
 assert.equal(configFor('example.com').enabled,false);
 assert.equal(configFor('vision-midia-digital.vercel.app').enabled,false);
 assert.equal(configFor('localhost').enabled,true);
 assert.equal(configFor('127.0.0.1').enabled,true);
 const js=fs.readFileSync('commercial-staging-config.js','utf8');
 assert.doesNotMatch(js,/fpadgedrgcxrrqflzhjt|sb_secret_/);
 assert.match(fs.readFileSync('commercial-config.js','utf8'),/enabled:false/);
});
test('login page uses staging-only public configuration; normal portal stays disconnected',()=>{
 const staging=fs.readFileSync('anunciante-homologacao.html','utf8');
 const normal=fs.readFileSync('anunciante.html','utf8');
 assert.match(staging,/AMBIENTE DE HOMOLOGAÇÃO/);
 assert.match(staging,/commercial-staging-config\.js/);
 assert.doesNotMatch(staging,/src="\.\/commercial-config\.js"/);
 assert.match(staging,/login-form/);
 assert.match(normal,/src="\.\/commercial-config\.js"/);
 assert.doesNotMatch(normal,/src="\.\/commercial-staging-config\.js"/);
});
test('staging Auth saves token only in isolated sessionStorage and sends no secret key',async()=>{
 await withGlobals(async({sessionStorage,localStorage})=>{
  const {CommercialAPI}=await import('../commercial-ui.mjs');
  const cfg=global.window.VISION_COMMERCIAL_CONFIG;
  let calls=0;
  global.fetch=async(url,opt)=>{
   calls++;
   assert.equal(url,STAGING+'/auth/v1/token?grant_type=password');
   assert.equal(opt.method,'POST');
   assert.equal(opt.headers.apikey,cfg.supabasePublishableKey);
   assert.equal(opt.headers.Authorization,undefined);
   assert.deepEqual(JSON.parse(opt.body),{email:'fixture@vision.test',password:'fictional-password'});
   return {ok:true,json:async()=>({access_token:'staging-fixture-token',refresh_token:'fixture-refresh',expires_in:3600})};
  };
  const api=new CommercialAPI();
  assert.equal(api.key,'vision_advertiser_session_v1_staging_v1');
  await api.login('fixture@vision.test','fictional-password');
  assert.equal(calls,1);
  assert.equal(api.session().access_token,'staging-fixture-token');
  assert.equal(sessionStorage.has('vision_advertiser_session_v1'),false);
  assert.equal(localStorage.has('vision_advertiser_session_v1_staging_v1'),false);
  api.clear();assert.equal(api.session(),null);
 });
});
test('a late password-login response never revives an invalidated session',async()=>{
 await withGlobals(async()=>{
  const {CommercialAPI}=await import('../commercial-ui.mjs');
  let resolve;
  global.fetch=()=>new Promise(r=>{resolve=r});
  const api=new CommercialAPI();
  const pending=api.login('fixture@vision.test','only-a-test');
  api.clear();
  resolve({ok:true,json:async()=>({access_token:'stale-token',refresh_token:'stale',expires_in:3600})});
  await assert.rejects(pending,/Sessão encerrada/);
  assert.equal(api.session(),null);
 });
});
test('invalid credentials cannot create a fake authenticated session',async()=>{
 await withGlobals(async()=>{
  const {CommercialAPI}=await import('../commercial-ui.mjs');
  global.fetch=async()=>({ok:false,status:400,json:async()=>({error:'invalid_grant'})});
  const api=new CommercialAPI();
  await assert.rejects(api.login('fixture@vision.test','wrong-password'),/invalid_grant/);
  assert.equal(api.session(),null);
 });
});
