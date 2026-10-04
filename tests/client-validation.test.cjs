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
test('master sees due companies while tenant sees only its subscription',()=>{
  const state={isPlatformAdmin:true,expiryCompanies:[{id:'due',subscription:{status:'active',current_period_end:new Date(Date.now()-1000).toISOString()}},{id:'later',subscription:{status:'active',current_period_end:new Date(Date.now()+9*86400000).toISOString()}}],company:{id:'own'},subscription:{status:'active',current_period_end:new Date().toISOString()}};
  const c=vm.createContext({state,Date});vm.runInContext(fn('currentDueNotices'),c);
  assert.equal(c.currentDueNotices().length,1);assert.equal(c.currentDueNotices()[0].company.id,'due');
  state.isPlatformAdmin=false;assert.equal(c.currentDueNotices()[0].company.id,'own');
});
test('video can be added to tenant playlist without overriding its duration',async()=>{
  const calls=[];const c=vm.createContext({state:{company:{id:'tenant'},editingPlaylistId:'playlist',playlistItems:[],media:[{id:'video',media_type:'video'}]},restRequest:async(t,o)=>calls.push({t,...o}),loadAllData:async()=>{},renderPlaylistEditor(){},toast(){throw Error('save failed')}});
  vm.runInContext(fn('addMediaToPlaylist'),c);await c.addMediaToPlaylist('video');
  assert.equal(calls[0].body.company_id,'tenant');assert.equal(calls[0].body.media_id,'video');assert.equal(calls[0].body.duration_override_seconds,null);
});
