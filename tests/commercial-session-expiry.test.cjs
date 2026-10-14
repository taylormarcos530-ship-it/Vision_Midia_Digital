const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const STAGING='https://jmiuitrrhtaeyrpuyohk.supabase.co';
function store(){
 const m=new Map();
 return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
}
async function withStaging(fn){
 const originals={window:global.window,sessionStorage:global.sessionStorage,localStorage:global.localStorage,fetch:global.fetch};
 const storage=store();
 global.window={VISION_COMMERCIAL_CONFIG:{enabled:true,environment:'staging',supabaseUrl:STAGING,supabasePublishableKey:'sb_publishable_fixture'}};
 global.sessionStorage=storage;global.localStorage=store();
 try{return await fn({storage});}finally{
  for(const [key,value] of Object.entries(originals)){if(value===undefined)delete global[key];else global[key]=value}
 }
}
function response(status,data){return {ok:status>=200&&status<300,status,json:async()=>data}}
const session=(access_token='stale-A')=>({access_token,refresh_token:'refresh-A',expires_at:1});

test('failed refresh after expired access token removes session and never retries stale API',async()=>{
 await withStaging(async({storage})=>{
  const {CommercialAPI}=await import('../commercial-ui.mjs');
  const api=new CommercialAPI();
  api.save(session());
  let rpcCalls=0,refreshCalls=0;
  global.fetch=async(url,opt)=>{
   assert.ok(url.startsWith(STAGING+'/'));
   if(url.endsWith('/rest/v1/rpc/vision_advertiser_portal')){
    rpcCalls++;assert.equal(opt.headers.Authorization,'Bearer stale-A');
    return response(401,{message:'JWT expired'});
   }
   if(url.includes('grant_type=refresh_token')){
    refreshCalls++;assert.equal(JSON.parse(opt.body).refresh_token,'refresh-A');
    return response(400,{error:'invalid_grant'});
   }
   throw new Error('unexpected external fetch');
  };
  await assert.rejects(api.rpc('vision_advertiser_portal'),/invalid_grant/);
  assert.equal(rpcCalls,1);assert.equal(refreshCalls,1);
  assert.equal(api.session(),null);
  assert.equal(storage.getItem('vision_advertiser_session_v1_staging_v1'),null);
 });
});
test('valid staging refresh retries with new JWT and keeps the same advertiser scope',async()=>{
 await withStaging(async()=>{
  const {CommercialAPI}=await import('../commercial-ui.mjs');
  const api=new CommercialAPI();
  api.save(session());
  let rpcCalls=0,refreshCalls=0;
  global.fetch=async(url,opt)=>{
   assert.ok(url.startsWith(STAGING+'/'));
   if(url.endsWith('/rest/v1/rpc/vision_advertiser_portal')){
    rpcCalls++;
    if(rpcCalls===1)return response(401,{message:'JWT expired'});
    assert.equal(opt.headers.Authorization,'Bearer fresh-A');
    return response(200,{advertiser:{id:'A'},campaigns:[{advertiser_id:'A'}],targets:[],daily:[]});
   }
   if(url.includes('grant_type=refresh_token')){
    refreshCalls++;
    return response(200,{access_token:'fresh-A',refresh_token:'refresh-new',expires_in:3600});
   }
   throw Error('unexpected URL');
  };
  const d=await api.rpc('vision_advertiser_portal');
  assert.equal(d.advertiser.id,'A');
  assert.equal(rpcCalls,2);assert.equal(refreshCalls,1);
  assert.equal(api.session().access_token,'fresh-A');
 });
});
test('logout drops local session even if remote logout endpoint fails',async()=>{
 await withStaging(async()=>{
  const {CommercialAPI}=await import('../commercial-ui.mjs');
  const api=new CommercialAPI();
  api.save(session('B-token'));
  global.fetch=async(url,opt)=>{
   assert.equal(url,STAGING+'/auth/v1/logout');
   assert.equal(opt.headers.Authorization,'Bearer B-token');
   return response(503,{error:'temporarily_unavailable'});
  };
  await assert.rejects(api.logout(),/temporarily_unavailable/);
  assert.equal(api.session(),null);
 });
});
function renderUI(api){
 const els=new Map();
 function element(id){
  if(!els.has(id))els.set(id,{
   hidden:id!=='#dashboard',textContent:'',innerHTML:'',className:'',
   replaceChildren(){this.innerHTML=''},
  });
  return els.get(id);
 }
 const ctx={
  CommercialAPI:function(){return api},
  document:{querySelector:element,hidden:false},
  URLSearchParams,location:{search:''},
  renderCampaigns:()=>'<div>Campanha B</div>',
  loadThumbnails:async()=>{},setInterval(){},FormData:function(){return {get:()=>''}}
 };
 const source=fs.readFileSync('advertiser-portal.mjs','utf8').replace(/^import[^\n]+\n/gm,'');
 vm.runInNewContext(source,ctx);
 return {element};
}
test('a failed token refresh removes the previous advertiser dashboard and requests login',async()=>{
 let reject;
 let active=true,cleared=0;
 const api={
  config:{environment:'staging',enabled:true},session(){return active?session('B-token'):null},
  rpc(){return new Promise((_,bad)=>{reject=bad})},
  clear(){active=false;cleared++},
  logout:async()=>{}
 };
 const {element}=renderUI(api);
 reject(Object.assign(new Error('invalid_grant'),{status:400}));
 await new Promise(r=>setImmediate(r));
 assert.equal(cleared,1);
 assert.equal(element('#dashboard').hidden,true);
 assert.equal(element('#campaigns').innerHTML,'');
 assert.equal(element('#login').hidden,false);
 assert.equal(element('#logout').hidden,true);
 assert.match(element('#status').textContent,/sessão expirou/i);
});
test('revoked advertiser access fails closed; B logout removes data before pending A results arrive',async()=>{
 let resolve;
 let active=true;
 const api={
  config:{environment:'staging',enabled:true},
  session(){return active?session('B-token'):null},
  rpc:()=>new Promise(ok=>{resolve=ok}),
  clear(){active=false},
  logout:async()=>{active=false}
 };
 const {element}=renderUI(api);
 element('#campaigns').innerHTML='<div>Old B campaign</div>';
 element('#dashboard').hidden=false;
 await element('#logout').onclick();
 assert.equal(element('#dashboard').hidden,true);
 assert.equal(element('#campaigns').innerHTML,'');
 assert.equal(element('#advertiser-name').textContent,'');
 assert.equal(element('#login').hidden,false);
 resolve({advertiser:{name:'A'},campaigns:[]});
 await new Promise(r=>setImmediate(r));
 assert.equal(element('#dashboard').hidden,true);
 assert.equal(element('#campaigns').innerHTML,'');
});
