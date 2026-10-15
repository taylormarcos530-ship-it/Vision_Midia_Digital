// OFFLINE ONLY: delayed signed URLs cannot outlive authorization or dashboard generations.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const uiPromise=import('../commercial-ui.mjs');
const media='commercial-ads/00000000-0000-4000-8000-000000000301.webp';
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const reply=(token='ok')=>({signedURL:'/object/sign/vision-media/'+media+'?token='+token});
function fixtureRoot(){
 const children=[],slots=new Map();
 const slot={
  isConnected:true,
  children:[],
  replaceChildren(...els){this.children=els},
  insertAdjacentHTML(_pos,_html){this.notice=(this.notice||0)+1},
  contains(el){return this.children.includes(el)}
 };
 const root={querySelector:selector=>selector==='[data-revision="rev-a"]'?slot:null};
 return {root,slot};
}
async function browserStubs(fn){
 const before=globalThis.document;
 const created=[];
 globalThis.document={createElement:type=>{const el={type,src:null,onerror:null};created.push(el);return el}};
 try{return await fn(created)}finally{if(before===undefined)delete globalThis.document;else globalThis.document=before}
}
const data={revisions:[{id:'rev-a',media_type:'image',name:'Comercial sintético',storage_path:media}]};
const api=request=>({config:{supabaseUrl:'https://fixture.invalid'},request});

test('revoked authentication prevents pending signature from rendering or signing additional revisions',async()=>{
 const {loadThumbnails}=await uiPromise;
 await browserStubs(async created=>{
  const {root,slot}=fixtureRoot(),slow=deferred();let authorized=true,requested=0;
  const copy={revisions:[...data.revisions,{...data.revisions[0]}]};
  const pending=loadThumbnails(root,copy,api(()=>{requested++;return slow.promise}),()=>authorized);
  authorized=false;slow.resolve(reply());await pending;
  assert.equal(requested,1);
  assert.equal(created.length,0);
  assert.equal(slot.children.length,0);
  assert.equal(slot.notice||0,0);
 });
});
test('logout during rejected signing must not add an error notice to closed dashboard',async()=>{
 const {loadThumbnails}=await uiPromise;
 await browserStubs(async created=>{
  const {root,slot}=fixtureRoot(),slow=deferred();let authorized=true;
  const pending=loadThumbnails(root,data,api(()=>slow.promise),()=>authorized);
  authorized=false;slot.isConnected=false;
  slow.reject(Object.assign(new Error('advertiser_unavailable'),{status:403}));
  await pending;
  assert.deepEqual(created,[]);assert.equal(slot.children.length,0);
  assert.equal(slot.notice||0,0);
 });
});
test('signed response from prior account is ignored after access token rotates',async()=>{
 const {loadThumbnails}=await uiPromise;
 await browserStubs(async()=>{
  const {root,slot}=fixtureRoot(),old=deferred();
  let token='account-a',requests=0;
  const earlier=loadThumbnails(root,data,api(()=>{requests++;return old.promise}),()=>token==='account-a');
  token='account-b';
  await loadThumbnails(root,data,api(async()=>{requests++;return reply('new-account')}),()=>token==='account-b');
  old.resolve(reply('old-account'));
  await earlier;
  assert.equal(requests,2);
  assert.equal(slot.children.length,1);
  assert.match(slot.children[0].src,/new-account/);
  assert.doesNotMatch(slot.children[0].src,/old-account/);
 });
});
test('late media decode error after logout does not replace newer login content',async()=>{
 const {loadThumbnails}=await uiPromise;
 await browserStubs(async()=>{
  const {root,slot}=fixtureRoot();let active=true;
  await loadThumbnails(root,data,api(async()=>reply('old')),()=>active);
  const oldEl=slot.children[0];active=false;
  slot.replaceChildren();
  active=true;
  await loadThumbnails(root,data,api(async()=>reply('new')),()=>active);
  oldEl.onerror();
  assert.equal(slot.children.length,1);
  assert.match(slot.children[0].src,/token=new/);
  assert.equal(slot.notice||0,0);
 });
});
function portalHarness(){
 const elements=new Map(),calls=[],signatures=[];
 function element(selector){
  if(!elements.has(selector))elements.set(selector,{
   hidden:selector==='#dashboard'?false:true,
   textContent:'',innerHTML:'',className:'',
   reset(){},value:'',disabled:false
  });
  return elements.get(selector)
 }
 let valid=true,token='token-a',clears=0;
 const mock={
  config:{environment:'staging',enabled:true},
  session(){return valid?{access_token:token}:null},
  rpc(){const pending=deferred();calls.push(pending);return pending.promise},
  clear(){valid=false;clears++},
  logout:async()=>{valid=false}
 };
 const source=fs.readFileSync('advertiser-portal.mjs','utf8').replace(/^import[^\n]+\n/gm,'');
 const context={
  CommercialAPI:function(){return mock},
  renderCampaigns:()=>'<article>Campanha sintética</article>',
  loadThumbnails:(root,payload,api,authorized)=>{
   signatures.push({root,payload,api,authorized});
   return new Promise(()=>{});
  },
  document:{querySelector:element,hidden:false,getElementById:()=>({value:'fixture'})},
  location:{search:''},URLSearchParams,
  setInterval(){},FormData:function(){return {get:()=>''}}
 };
 vm.runInNewContext(source,context);
 return {element,calls,signatures,mock,clearCount:()=>clears,
  setToken:v=>{token=v},setValid:v=>{valid=v}};
}
const payload={advertiser:{name:'Anunciante fictício'},campaigns:[],revisions:[],daily:[],targets:[]};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('refresh processes new portal RPC without waiting for pending preview signatures',async()=>{
 const h=portalHarness();
 assert.equal(h.calls.length,1);
 h.calls[0].resolve(payload);await tick();
 assert.equal(h.signatures.length,1);
 assert.equal(h.signatures[0].authorized(),true);
 h.element('#refresh').onclick();
 assert.equal(h.calls.length,2,'new portal request starts despite unresolved preview');
 assert.equal(h.signatures[0].authorized(),false,'old preview loses dashboard generation');
 h.calls[1].resolve(payload);await tick();
 assert.equal(h.signatures.length,2);
 assert.equal(h.signatures[1].authorized(),true);
 assert.equal(h.element('#dashboard').hidden,false);
});
test('logout invalidates outstanding previews and clears campaign HTML immediately',async()=>{
 const h=portalHarness();
 h.calls[0].resolve(payload);await tick();
 const old=h.signatures[0].authorized;
 assert.equal(old(),true);
 h.element('#campaigns').innerHTML='<div>old campaign</div>';
 await h.element('#logout').onclick();
 assert.equal(old(),false);
 assert.equal(h.element('#campaigns').innerHTML,'');
 assert.equal(h.element('#dashboard').hidden,true);
 assert.equal(h.element('#login').hidden,false);
});
test('revoked 403 RPC discards all pending previews and cannot restore advertiser view',async()=>{
 const h=portalHarness();
 h.calls[0].resolve(payload);await tick();
 const before=h.signatures[0].authorized;
 h.element('#refresh').onclick();
 h.calls[1].reject(Object.assign(new Error('advertiser_unavailable'),{status:403}));
 await tick();
 assert.equal(h.clearCount(),1);
 assert.equal(h.element('#dashboard').hidden,true);
 assert.equal(h.element('#campaigns').innerHTML,'');
 assert.equal(before(),false);
 assert.equal(h.element('#login').hidden,false);
});
test('external session replacement invalidates media even before a refresh occurs',async()=>{
 const h=portalHarness();h.calls[0].resolve(payload);await tick();
 const prior=h.signatures[0].authorized;
 h.setToken('token-b');
 assert.equal(prior(),false);
 h.element('#refresh').onclick();
 h.calls[1].resolve(payload);await tick();
 assert.equal(h.signatures[1].authorized(),true);
});
