// OFFLINE LAB ONLY: no Supabase login, network, storage writes, deployment or APK.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const load=()=>import('../commercial-ui.mjs');
const uuid='00000000-0000-4000-8000-000000000301';
const path='commercial-ads/'+uuid+'.webp';
const videoPath='commercial-ads/00000000-0000-4000-8000-000000000302.mp4';
const secret='private-owner/point-source.webp';
function sample(){
 return {
  advertiser:{id:'adv-a',name:'Anunciante A'},
  today:'2026-10-14',
  campaigns:[{id:'campaign-a',advertiser_id:'adv-a',name:'Campanha comercial',
   current_revision_id:'r1',status:'active',start_date:'2026-10-01',end_date:'2026-10-31'}],
  revisions:[{id:'r1',campaign_id:'campaign-a',name:'Vídeo promocional',
   media_type:'image',storage_path:path,duration_seconds:10}],
  targets:[{campaign_id:'campaign-a',device_id:'point-a',point_name:'Oficina fictícia',
   device_name:'TV bancada',active:true,online:false,last_seen_at:null}],
  daily:[{campaign_id:'campaign-a',device_id:'point-a',day:'2026-10-14',
   attempt_count:5,completed_count:2,last_completed_at:'2026-10-14T12:00:00Z'}]
 };
}
async function fakeDom(fn){
 const previousDocument=globalThis.document,previousCss=globalThis.CSS;
 const slots=new Map(),created=[],selectors=[];
 globalThis.CSS={escape:s=>s};
 globalThis.document={createElement:tag=>{const node={tag,src:null,alt:null,controls:false};
  created.push(node);return node;}};
 const root={querySelector:selector=>{
  selectors.push(selector);
  const id=selector.match(/data-revision="([^"]+)"/)?.[1];
  if(!slots.has(id))slots.set(id,{children:[],fallback:null,
   replaceChildren(...nodes){this.children=nodes},
   insertAdjacentHTML(_where,html){this.fallback=html}});
  return slots.get(id);
 }};
 try{return await fn({root,slots,created,selectors});}
 finally{
  if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  if(previousCss===undefined)delete globalThis.CSS;else globalThis.CSS=previousCss;
 }
}
test('sanitized portal payload still renders advertiser campaign, base details and completed metrics',async()=>{
 const {renderCampaigns}=await load();
 const html=renderCampaigns(sample());
 assert.match(html,/Campanha comercial/);
 assert.match(html,/Vídeo promocional/);
 assert.match(html,/Oficina fictícia/);
 assert.match(html,/Exibições hoje/);
 assert.match(html,/>2<\/strong>/);
 assert.match(html,/Prévia da propaganda/);
 assert.doesNotMatch(html,/source_storage_path|source_media_id|source_updated_at/);
 assert.doesNotMatch(html,/private-owner/);
});
test('preview path accepts only isolated UUID commercial snapshots, never original owner media',async()=>{
 const {commercialPreviewPath}=await load();
 for(const value of [path,videoPath,'commercial-ads/'+uuid+'.png',
  'commercial-ads/'+uuid+'.jpg','commercial-ads/'+uuid+'.webm',
  'commercial-ads/'+uuid])assert.equal(commercialPreviewPath(value),value);
 for(const value of [secret,'media/test.webp','customer/normal.mp4',
  'commercial-ads/../private-owner/file.webp',
  'commercial-ads/'+uuid+'/../../media.webp',
  'commercial-ads/'+uuid+'.webp?download=1',
  'commercial-ads/'+uuid+'.svg','commercial-ads/not-a-uuid.webp',
  'commercial-ads/'+uuid+'.webp/evil','/commercial-ads/'+uuid+'.webp',
  'commercial-ads/'+uuid+'.webp#fragment',
  null,{},''])assert.equal(commercialPreviewPath(value),null);
});
test('approved advertiser commercial copy generates one short-lived sign request',async()=>{
 const {loadThumbnails}=await load();
 await fakeDom(async({root,slots,created})=>{
  const paths=[];
  const api={config:{supabaseUrl:'https://fixture-supabase.invalid'},
   async request(url,opts){
    paths.push({url,opts});
    return {signedURL:'/object/sign/vision-media/'+path+'?token=fake-token'};
   }};
  await loadThumbnails(root,sample(),api);
  assert.equal(paths.length,1);
  assert.equal(paths[0].url,'/storage/v1/object/sign/vision-media/'+path);
  assert.deepEqual(paths[0].opts,{body:{expiresIn:60}});
  assert.equal(created.length,1);
  assert.equal(created[0].tag,'img');
  assert.equal(created[0].src,
   'https://fixture-supabase.invalid/storage/v1/object/sign/vision-media/'+path+'?token=fake-token');
  assert.equal(created[0].alt,'Vídeo promocional');
  assert.equal(slots.get('r1').children[0],created[0]);
 });
});
test('video copy remains playable as a video element without requesting point media',async()=>{
 const {loadThumbnails}=await load();
 await fakeDom(async({root,created})=>{
  const data=sample();
  data.revisions[0].storage_path=videoPath;
  data.revisions[0].media_type='video';
  const api={config:{supabaseUrl:'https://fixture-supabase.invalid'},
   async request(){return {signedUrl:'/object/sign/vision-media/'+videoPath+'?token=test'}}};
  await loadThumbnails(root,data,api);
  assert.equal(created.length,1);
  assert.equal(created[0].tag,'video');
  assert.equal(created[0].controls,true);
  assert.equal(created[0].preload,'metadata');
  assert.equal(created[0].playsInline,true);
  assert.match(created[0].src,/commercial-ads\/.*\.mp4\?token=test/);
 });
});
test('source path, traversal or invalid copy is never sent for signing',async()=>{
 const {loadThumbnails}=await load();
 await fakeDom(async({root,created})=>{
  const data=sample();data.revisions=[
   {id:'owner',name:'Proibido',media_type:'image',storage_path:secret},
   {id:'bad',name:'Proibido',media_type:'video',storage_path:'commercial-ads/../../'+secret},
   {id:'empty',name:'Sem snapshot',media_type:'image',storage_path:null}
  ];
  const calls=[];
  const api={config:{supabaseUrl:'https://fixture-supabase.invalid'},
   async request(url){calls.push(url);throw Error('Should never request') }};
  await loadThumbnails(root,data,api);
  assert.deepEqual(calls,[]);
  assert.deepEqual(created,[]);
 });
});
test('mixed revisions request only own valid commercial copies',async()=>{
 const {loadThumbnails}=await load();
 await fakeDom(async({root,created})=>{
  const data=sample();data.revisions=[
   {...data.revisions[0],source_storage_path:secret,source_media_id:'owner-media-id'},
   {id:'unsafe',storage_path:secret},
   {id:'empty',storage_path:''}
  ];
  const calls=[];
  const api={config:{supabaseUrl:'https://fixture-supabase.invalid'},
   async request(url){calls.push(url);
    return {signedURL:'/object/sign/vision-media/'+path+'?token=valid'}}
  };
  await loadThumbnails(root,data,api);
  assert.deepEqual(calls,['/storage/v1/object/sign/vision-media/'+path]);
  assert.equal(created.length,1);
  assert.equal(created[0].src.includes(secret),false);
 });
});
test('signed URL from another host or a different object path is not inserted',async()=>{
 const {loadThumbnails}=await load();
 for(const signedURL of [
  'https://malicious.invalid/storage/v1/object/sign/vision-media/'+path+'?token=bad',
  '/object/sign/vision-media/'+secret+'?token=bad',
  '/object/sign/vision-media/'+videoPath+'?token=wrong-object'
 ]){
  await fakeDom(async({root,created,slots})=>{
   const api={config:{supabaseUrl:'https://fixture-supabase.invalid'},
    async request(){return {signedURL}}};
   await loadThumbnails(root,sample(),api);
   assert.deepEqual(created,[],'unexpected preview for '+signedURL);
   assert.deepEqual(slots.get('r1').children,[]);
  });
 }
});
test('sign failure keeps existing UI available and marks preview unavailable',async()=>{
 const {loadThumbnails}=await load();
 await fakeDom(async({root,created,slots})=>{
  const api={config:{supabaseUrl:'https://fixture-supabase.invalid'},
   async request(){throw Error('403 no signed preview access')}};
  await loadThumbnails(root,sample(),api);
  assert.deepEqual(created,[]);
  assert.equal(slots.get('r1').fallback,'<small>Prévia indisponível no momento.</small>');
 });
});
test('malicious campaign names remain escaped after switching to reduced projection',async()=>{
 const {renderCampaigns}=await load();
 const data=sample();data.campaigns[0].name='<img src=x onerror=alert(1)>';
 data.revisions[0].name='<script>alert(2)</script>';
 const html=renderCampaigns(data);
 assert.doesNotMatch(html,/<script>|<img src=x/);
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.match(html,/&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
});
test('local frontend is not connected to production gateway, and RLS fixture remains opt-in',()=>{
 const p=fs.readFileSync('tests/fixtures/commercial-safe-projection-lab.sql','utf8');
 const source=fs.readFileSync('commercial-ui.mjs','utf8');
 const gateway=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
 assert.match(p,/LAB FIXTURE ONLY/);
 assert.match(source,/commercialPreviewPath/);
 assert.doesNotMatch(source,/source_storage_path|source_media_id/);
 assert.doesNotMatch(gateway,/commercialPreviewPath|commercial-safe-projection-lab/);
});
