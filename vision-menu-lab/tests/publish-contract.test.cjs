const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root=path.join(__dirname,'..');
const load=async()=>{
  const [pub,fixtures,data]=await Promise.all([
    import(pathToFileURL(path.join(root,'publish-contract.mjs')).href),
    import(pathToFileURL(path.join(root,'fixtures/publish-lab.mjs')).href),
    import(pathToFileURL(path.join(root,'menu-data.mjs')).href),
  ]);
  return {...pub,...fixtures,...data};
};
const create=async()=>{const api=await load();return {api,store:api.createPublishLab(api)}};
const owner={actorId:'owner-butcher',companyId:'demo-butcher'};
const other={actorId:'owner-bakery',companyId:'demo-bakery'};
const free='tv-butcher-free';
const raw=(api,vid='video-butcher-demo')=>({...api.createState(),videoAssetId:vid});
function saved(store,api,actor=owner){return store.saveDraft({...actor,expectedVersion:0,document:raw(api)})}
const failed=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('lab publication stays disabled by default on all fictional TVs', async()=>{
  const {store}=await create();
  for(const d of store.listDevices(owner)) {assert.equal(d.menuEnabled,false);assert.equal(d.menuVersion,0)}
});
test('draft save is tenant-specific and revisioned', async()=>{
  const {api,store}=await create();
  const entry=saved(store,api);assert.equal(entry.version,1);
  assert.equal(store.currentDraft(owner).version,1);
  assert.equal(store.currentDraft(other),null);
});
test('successful preflight and confirmed publish affect only the selected fictional TV',async()=>{
  const {api,store}=await create();saved(store,api);
  const p=store.preflight({...owner,deviceId:free});
  assert.deepEqual([p.expectedDraftVersion,p.expectedDeviceVersion,p.mode],[1,0,'menu-only']);
  const published=store.simulatePublish({...owner,deviceId:free,...p,confirm:true});
  assert.equal(published.enabled,true);assert.equal(published.version,1);
  assert.equal(store.publishedForDevice({...owner,deviceId:'tv-butcher-playlist'}),null);
  assert.equal(store.publishedForDevice({...owner,deviceId:'tv-butcher-ads'}),null);
});
test('unconfirmed publish is blocked even when preflight passes',async()=>{
  const {api,store}=await create();saved(store,api);
  const p=store.preflight({...owner,deviceId:free});
  failed(()=>store.simulatePublish({...owner,deviceId:free,...p,confirm:false}),'confirmation_required');
  assert.equal(store.publishedForDevice({...owner,deviceId:free}),null);
});
test('playlist or commercial TV is protected, even with a valid menu draft',async()=>{
  const {api,store}=await create();saved(store,api);
  failed(()=>store.preflight({...owner,deviceId:'tv-butcher-playlist'}),'playlist_protected');
  failed(()=>store.preflight({...owner,deviceId:'tv-butcher-ads'}),'commercial_protected');
});
test('TV of a different company is never selectable or writable',async()=>{
  const {api,store}=await create();saved(store,api);
  assert.ok(!store.listDevices(owner).some(d=>d.id==='tv-bakery-free'));
  failed(()=>store.preflight({...owner,deviceId:'tv-bakery-free'}),'not_found');
  failed(()=>store.publishedForDevice({...owner,deviceId:'tv-bakery-free'}),'not_found');
});
test('actor cannot assume another tenant or owner role',async()=>{
  const {api,store}=await create();
  failed(()=>store.saveDraft({...other,companyId:'demo-butcher',expectedVersion:0,document:raw(api)}),'forbidden');
  failed(()=>store.saveDraft({actorId:'viewer-butcher',companyId:'demo-butcher',expectedVersion:0,document:raw(api)}),'forbidden');
  assert.deepEqual(store.listDevices(other).map(x=>x.id),['tv-bakery-free']);
});
test('foreign video is rejected at save time',async()=>{
  const {api,store}=await create();
  failed(()=>store.saveDraft({...owner,expectedVersion:0,document:raw(api,'video-bakery-demo')}),'media_mismatch');
  assert.equal(store.currentDraft(owner),null);
});
test('local blob URLs and arbitrary external media URLs cannot enter the publication contract',async()=>{
  const {api,store}=await create();
  for(const url of ['blob:https://example.invalid/a','https://example.invalid/ad.mp4']){
    failed(()=>store.saveDraft({...owner,expectedVersion:0,document:raw(api,url)}),'media_mismatch');
  }
});
test('missing active products blocks publication',async()=>{
  const {api,store}=await create();const input=raw(api);input.products.forEach(x=>x.enabled=false);
  store.saveDraft({...owner,expectedVersion:0,document:input});
  failed(()=>store.preflight({...owner,deviceId:free}),'no_products');
});
test('missing video blocks publication',async()=>{
  const {api,store}=await create();store.saveDraft({...owner,expectedVersion:0,document:raw(api,null)});
  failed(()=>store.preflight({...owner,deviceId:free}),'no_video');
});
test('interleaving and arbitrary programming modes remain unavailable',async()=>{
  const {api,store}=await create();saved(store,api);
  for(const mode of ['interleave','playlist','campaign'])failed(()=>store.preflight({...owner,deviceId:free,mode}),'unsupported_mode');
});
test('stale draft version cannot be saved or published',async()=>{
  const {api,store}=await create();saved(store,api);const p=store.preflight({...owner,deviceId:free});
  failed(()=>store.saveDraft({...owner,expectedVersion:0,document:raw(api)}),'conflict');
  store.saveDraft({...owner,expectedVersion:1,document:raw(api)});
  failed(()=>store.simulatePublish({...owner,...p,confirm:true}),'conflict');
});
test('publishing refuses stale device version on repeated attempts',async()=>{
  const {api,store}=await create();saved(store,api);const p=store.preflight({...owner,deviceId:free});
  store.simulatePublish({...owner,...p,confirm:true});
  failed(()=>store.simulatePublish({...owner,...p,confirm:true}),'conflict');
});
test('published snapshot stays stable after a later draft update',async()=>{
  const {api,store}=await create();saved(store,api);const p=store.preflight({...owner,deviceId:free});
  const pub=store.simulatePublish({...owner,...p,confirm:true});const newDraft=raw(api);newDraft.products[0].priceCents=9999;
  store.saveDraft({...owner,expectedVersion:1,document:newDraft});
  const unchanged=store.publishedForDevice({...owner,deviceId:free});
  assert.equal(unchanged.document.products[0].priceCents,pub.document.products[0].priceCents);
  assert.notEqual(unchanged.document.products[0].priceCents,newDraft.products[0].priceCents);
});
test('publication and current drafts are returned by copy, not mutable shared references',async()=>{
  const {api,store}=await create();saved(store,api);const p=store.preflight({...owner,deviceId:free});
  const result=store.simulatePublish({...owner,...p,confirm:true});
  result.document.products[0].name='Manipulado';
  assert.notEqual(store.publishedForDevice({...owner,deviceId:free}).document.products[0].name,'Manipulado');
});
test('disabling menu does not rewrite original playlists or campaign fields',async()=>{
  const {api,store}=await create();saved(store,api);const p=store.preflight({...owner,deviceId:free});
  const pub=store.simulatePublish({...owner,...p,confirm:true});
  const disabled=store.disableSimulatedMenu({...owner,deviceId:free,expectedDeviceVersion:pub.version});
  assert.equal(disabled.enabled,false);
  assert.equal(disabled.version,2);
  assert.equal(store.listDevices(owner).find(d=>d.id===free).basePlaylistId,null);
  assert.equal(store.listDevices(owner).find(d=>d.id==='tv-butcher-playlist').basePlaylistId,'playlist-protected');
  assert.equal(store.listDevices(owner).find(d=>d.id==='tv-butcher-ads').commercialActive,true);
});
test('stale disable or disabling unpublished TV is rejected',async()=>{
  const {api,store}=await create();
  failed(()=>store.disableSimulatedMenu({...owner,deviceId:free,expectedDeviceVersion:0}),'conflict');
  saved(store,api);const p=store.preflight({...owner,deviceId:free});store.simulatePublish({...owner,...p,confirm:true});
  failed(()=>store.disableSimulatedMenu({...owner,deviceId:free,expectedDeviceVersion:0}),'conflict');
});
test('audit log records tenant actions without exposing another tenant',async()=>{
  const {api,store}=await create();saved(store,api);const p=store.preflight({...owner,deviceId:free});store.simulatePublish({...owner,...p,confirm:true});
  assert.deepEqual(store.auditForCompany(owner).map(x=>x.action),['save_draft','simulate_publish']);
  assert.deepEqual(store.auditForCompany(other),[]);
});
test('lab files never import official runtime, external API or secrets',async()=>{
  for(const n of ['publish-contract.mjs','publish-lab.js','publish-lab.html','publish-lab.css','fixtures/publish-lab.mjs']){
    const src=fs.readFileSync(path.join(root,n),'utf8');
    assert.doesNotMatch(src,/\bfetch\s*\(|XMLHttpRequest|supabase\.co|service_role|navigator\.serviceWorker|VisionAndroid|device-gateway|window\.location\s*=/);
  }
  const html=fs.readFileSync(path.join(root,'publish-lab.html'),'utf8');
  assert.match(html,/SEM ACESSO A TVS REAIS/);
});
