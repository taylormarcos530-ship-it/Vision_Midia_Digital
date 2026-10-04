const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function fn(name){const marker=app.includes(`  function ${name}(`)?`  function ${name}(`:`  async function ${name}(`;const start=app.indexOf(marker);assert.ok(start>=0);return app.slice(start,app.indexOf('\n  }',start)+4)}
test('outside pointer closes sidebar while inside and menu button preserve it',()=>{
  let open=true;const sidebar={classList:{contains:()=>open,remove:()=>open=false},contains:t=>t==='inside'};
  const c=vm.createContext({$:s=>s==='#sidebar'?sidebar:{contains:t=>t==='button'}});
  vm.runInContext(fn('dismissSidebarFromOutside'),c);
  for(const target of ['inside','button']){c.dismissSidebarFromOutside({target});assert.equal(open,true)}
  c.dismissSidebarFromOutside({target:'outside'});assert.equal(open,false);
});
test('inbox keeps only three newest messages before applying read filter',()=>{
 const state={notificationFilter:'all',notifications:[{id:'1',is_read:false},{id:'2',is_read:true},{id:'3',is_read:false},{id:'4',is_read:false}]};
 const c=vm.createContext({state});vm.runInContext(fn('visibleInboxItems'),c);
 assert.equal(c.visibleInboxItems().length,3);state.notificationFilter='read';assert.equal(c.visibleInboxItems()[0].id,'2');
 state.notificationFilter='unread';assert.equal(c.visibleInboxItems().length,2);
});
test('video can be added to tenant playlist without overriding its duration',async()=>{
  const calls=[];const c=vm.createContext({state:{company:{id:'tenant'},editingPlaylistId:'playlist',playlistItems:[],media:[{id:'video',media_type:'video'}]},restRequest:async(t,o)=>calls.push({t,...o}),loadAllData:async()=>{},renderPlaylistEditor(){},toast(){throw Error('save failed')}});
  vm.runInContext(fn('addMediaToPlaylist'),c);await c.addMediaToPlaylist('video');
  assert.equal(calls[0].body.company_id,'tenant');assert.equal(calls[0].body.media_id,'video');assert.equal(calls[0].body.duration_override_seconds,null);
});
test('storage shows tenant library bytes and honors overrides, full and missing limits',()=>{
 const state={publicConfig:{plans:[{id:'pro',storage_limit_mb:1024}]},subscription:{plan_id:'pro'},media:[{size_bytes:268435456},{size_bytes:0}]};
 const c=vm.createContext({state});vm.runInContext(fn('currentStoragePlanUsage'),c);
 assert.equal(c.currentStoragePlanUsage().remaining,768*1024*1024);
 state.subscription.limit_overrides={storage_limit_mb:128};assert.equal(c.currentStoragePlanUsage().remaining,0);
 state.subscription.limit_overrides.storage_limit_mb=0;assert.equal(c.currentStoragePlanUsage().limit,0);
 state.subscription={plan_id:'missing'};assert.equal(c.currentStoragePlanUsage().remaining,null);
});
test('unlink deletes only the selected tenant playlist association and preserves library media',async()=>{
 const calls=[];const state={company:{id:'tenant'},playlists:[{id:'p1'}],playlistItems:[{media_id:'m1',playlist_id:'p1'}],media:[{id:'m1'}]};
 const c=vm.createContext({state,encodeURIComponent,restRequest:async(t,o)=>calls.push({t,...o}),loadAllData:async()=>{},toast(){}});
 vm.runInContext(fn('unlinkMediaFromPlaylist'),c);
 await c.unlinkMediaFromPlaylist('m1','unknown');assert.equal(calls.length,0);
 await c.unlinkMediaFromPlaylist('m1','p1');assert.equal(calls.length,1);assert.equal(calls[0].t,'playlist_items');assert.equal(calls[0].method,'DELETE');assert.equal(calls[0].query,'company_id=eq.tenant&playlist_id=eq.p1&media_id=eq.m1');assert.equal(state.media.length,1);
});
