const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const URL='https://jmiuitrrhtaeyrpuyohk.supabase.co';
const config={enabled:true,environment:'staging',supabaseUrl:URL,supabasePublishableKey:'sb_publishable_only_test'};
async function load(){return import('../commercial-staging-diagnostics.mjs')}
const health=async(url,options)=>{
 assert.equal(url,URL+'/auth/v1/health');
 assert.equal(options.method,'GET');
 assert.equal(options.headers.apikey,config.supabasePublishableKey);
 assert.equal(options.headers.Authorization,undefined);
 assert.equal(options.body,undefined);
 return {ok:true,status:200};
};
function portal(id='a'){
 return {advertiser:{id,name:'Anunciante '+id.toUpperCase()+' - Homologacao'},
  campaigns:[{id:'campaign-'+id,advertiser_id:id,status:'draft',name:'Campaign '+id}],
  targets:[],daily:[]};
}
test('diagnostic refuses production config before any network request',async()=>{
 const {checkStagingAccess}=await load();
 let calls=0;
 const mock=async()=>{calls++;return {ok:true}};
 for(const c of [null,{}, {...config,enabled:false},
  {...config,supabaseUrl:'https://fpadgedrgcxrrqflzhjt.supabase.co'},
  {...config,environment:'production'}, {...config,supabasePublishableKey:'sb_secret_demo'}]){
  const r=await checkStagingAccess(c,{session(){return null}},mock);
  assert.equal(r.ok,false);
 }
 assert.equal(calls,0);
});
test('health check is anonymous, read only, and never fabricates a login',async()=>{
 const {checkStagingAccess}=await load();
 const api={session(){return null},rpc(){throw new Error('No RPC before login')}};
 const r=await checkStagingAccess(config,api,health);
 assert.equal(r.ok,true);assert.equal(r.authenticated,false);
 assert.match(r.lines.join(' '),/Login: ainda não efetuado/);
});
test('authenticated checks return only the current advertiser summary, never other advertiser data',async()=>{
 const {checkStagingAccess}=await load();
 for(const id of ['a','b']){
  let calls=0;
  const api={session(){return {access_token:'temporary-token'}},rpc(name){
   calls++;assert.equal(name,'vision_advertiser_portal');return Promise.resolve(portal(id));
  }};
  const r=await checkStagingAccess(config,api,health);
  assert.equal(r.ok,true);assert.equal(r.authenticated,true);assert.equal(calls,1);
  assert.match(r.lines.join(' '),new RegExp('Anunciante '+id.toUpperCase()));
  assert.match(r.lines.join(' '),/Campanhas da conta: 1 \(rascunhos: 1\)/);
  assert.match(r.lines.join(' '),/Vínculos com TVs de teste: 0/);
  assert.match(r.lines.join(' '),/Exibições registradas para esta conta: 0/);
  assert.doesNotMatch(r.lines.join(' '),/temporary-token/);
 }
});
test('diagnostic fails closed on cross-advertiser rows and on access denied',async()=>{
 const {checkStagingAccess}=await load();
 const mixed=portal('a');mixed.campaigns[0].advertiser_id='b';
 const api={session(){return {access_token:'a'}},rpc(){return Promise.resolve(mixed)}};
 const res=await checkStagingAccess(config,api,health);
 assert.equal(res.ok,false);
 assert.match(res.lines.join(' '),/Divergência de isolamento/);
 const forbidden={session(){return {access_token:'a'}},rpc(){
   return Promise.reject(Object.assign(new Error('advertiser_unavailable'),{status:403}));
 }};
 const denied=await checkStagingAccess(config,forbidden,health);
 assert.equal(denied.ok,false);
 assert.match(denied.lines.join(' '),/Acesso não autorizado/);
});
test('late response after logout must not show a previous account',async()=>{
 const {checkStagingAccess}=await load();
 let resolve,accessToken='a';
 const api={
  session(){return accessToken?{access_token:accessToken}:null},
  rpc(){return new Promise(r=>{resolve=r})}
 };
 const pending=checkStagingAccess(config,api,health);
 await new Promise(r=>setImmediate(r));
 accessToken=null;
 resolve(portal('a'));
 const r=await pending;
 assert.equal(r.ok,false);
 assert.doesNotMatch(r.lines.join(' '),/Anunciante A/);
 assert.match(r.lines.join(' '),/sessão mudou/);
});
test('staging diagnostic lives only in homologation HTML and uses textContent',()=>{
 const html=fs.readFileSync('anunciante-homologacao.html','utf8');
 const regular=fs.readFileSync('anunciante.html','utf8');
 const script=fs.readFileSync('commercial-staging-diagnostics.mjs','utf8');
 assert.match(html,/id="staging-check-access"/);
 assert.match(html,/commercial-staging-diagnostics\.mjs/);
 assert.match(html,/role="status"/);
 assert.doesNotMatch(regular,/commercial-staging-diagnostics/);
 assert.doesNotMatch(regular,/staging-check-access/);
 assert.match(script,/output\.textContent=result\.lines\.join/);
 assert.doesNotMatch(script,/innerHTML|localStorage|sessionStorage|\/auth\/v1\/token|\/auth\/v1\/user/);
 assert.doesNotMatch(script,/fpadgedrgcxrrqflzhjt/);
});
