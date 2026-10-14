const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const load=()=>import('../commercial-tv-media-controller.mjs');

test('player test harness starts paused and draws base before ads',async()=>{
 const {createMediaTestPlayer,mediaTestView,mediaTestEvent}=await load();
 const p=createMediaTestPlayer();
 const view=mediaTestView(p);
 assert.equal(view.playing,false);
 assert.equal(view.current.id,'base-1');
 assert.equal(view.included,2);
 assert.equal(view.items.length,8);
 assert.equal(mediaTestEvent(p,{type:'ended',key:view.key}).accepted,false);
 const s=mediaTestEvent(p,{type:'start'});
 assert.equal(s.accepted,true);
 assert.equal(s.player.playing,true);
 assert.equal(s.player.state.position,0);
});
test('real video-ended event can complete exactly one item per playback key',async()=>{
 const {createMediaTestPlayer,mediaTestView,mediaTestEvent}=await load();
 let p=mediaTestEvent(createMediaTestPlayer(),{type:'start'}).player;
 const original=mediaTestView(p).key;
 p=mediaTestEvent(p,{type:'ended',key:original}).player;
 assert.equal(mediaTestView(p).position,1);
 const duplicate=mediaTestEvent(p,{type:'ended',key:original});
 assert.equal(duplicate.accepted,false);
 assert.equal(duplicate.player.state.position,1);
 assert.equal(duplicate.player.state.completedItems,1);
 const right=mediaTestView(p).key;
 assert.notEqual(right,original);
 p=mediaTestEvent(p,{type:'ended',key:right}).player;
 assert.equal(p.state.position,2);
 assert.equal(p.state.completedItems,2);
});
test('five full local playback cycles rotate each commercial twice, with no fake impression writes',async()=>{
 const {createMediaTestPlayer,mediaTestEvent,mediaTestView}=await load();
 let p=mediaTestEvent(createMediaTestPlayer(),{type:'start'}).player;
 const counts=new Map();
 for(let n=0;n<5;n++){
  const manifest=mediaTestView(p);
  assert.equal(manifest.cycle,n);
  assert.equal(manifest.items.length,8);
  for(const ad of manifest.items.filter(x=>x.commercial))counts.set(ad.id,(counts.get(ad.id)||0)+1);
  for(let i=0;i<8;i++){
   const token=mediaTestView(p).key;
   p=mediaTestEvent(p,{type:'ended',key:token}).player;
  }
 }
 assert.equal(p.state.cycle,5);
 assert.equal(p.state.completedItems,40);
 assert.deepEqual(Object.fromEntries([...counts].sort()),{
  'commercial-1':2,'commercial-2':2,'commercial-3':2,'commercial-4':2,'commercial-5':2
 });
});
test('commercial media error stops and disables ads without advancing or claiming playback',async()=>{
 const {createMediaTestPlayer,mediaTestEvent,mediaTestView}=await load();
 let p=mediaTestEvent(createMediaTestPlayer(),{type:'start'}).player;
 for(let i=0;i<3;i++)p=mediaTestEvent(p,{type:'ended',key:mediaTestView(p).key}).player;
 const commercial=mediaTestView(p);
 assert.equal(commercial.current.commercial,true);
 const result=mediaTestEvent(p,{type:'media-error',key:commercial.key});
 assert.equal(result.accepted,true);
 p=result.player;
 assert.equal(p.playing,false);
 assert.equal(p.state.options.enabled,false);
 assert.equal(p.state.completedItems,3,'the failed ad must never be recorded as completed');
 assert.equal(p.failures,1);
 assert.equal(mediaTestView(p).included,0);
 assert.deepEqual(mediaTestView(p).items.map(i=>i.id),
  ['base-1','base-2','base-3','base-4','base-5','base-6']);
 assert.equal(mediaTestEvent(p,{type:'ended',key:commercial.key}).accepted,false);
});
test('failed establishment media pauses at same position and rejects outdated events',async()=>{
 const {createMediaTestPlayer,mediaTestEvent,mediaTestView}=await load();
 const start=mediaTestEvent(createMediaTestPlayer(),{type:'start'}).player;
 const token=mediaTestView(start).key;
 const next=mediaTestEvent(start,{type:'media-error',key:token});
 assert.equal(next.accepted,true);
 assert.equal(next.player.playing,false);
 assert.equal(next.player.state.position,0);
 assert.equal(next.player.state.completedItems,0);
 assert.equal(next.player.state.options.enabled,true);
 assert.equal(mediaTestEvent(next.player,{type:'media-error',key:token}).accepted,false);
});
test('simulated disconnect, reconnect and restart never continue playback without fresh start',async()=>{
 const {createMediaTestPlayer,mediaTestEvent,mediaTestView}=await load();
 let p=mediaTestEvent(createMediaTestPlayer(),{type:'start'}).player;
 p=mediaTestEvent(p,{type:'ended',key:mediaTestView(p).key}).player;
 const prior=mediaTestView(p).key;
 p=mediaTestEvent(p,{type:'disconnect'}).player;
 assert.equal(p.playing,false);assert.equal(p.state.position,1);
 assert.equal(mediaTestEvent(p,{type:'ended',key:prior}).accepted,false);
 p=mediaTestEvent(p,{type:'reconnect'}).player;
 assert.equal(p.state.position,1);assert.equal(p.playing,false);
 p=mediaTestEvent(p,{type:'restart'}).player;
 assert.equal(p.state.position,1);assert.equal(p.playing,false);
 assert.equal(mediaTestEvent(p,{type:'ended',key:prior}).accepted,false);
 p=mediaTestEvent(p,{type:'start'}).player;
 assert.equal(p.playing,true);
 assert.equal(mediaTestEvent(p,{type:'ended',key:prior}).accepted,false);
 assert.equal(mediaTestEvent(p,{type:'ended',key:mediaTestView(p).key}).accepted,true);
});
test('without assigned playlist, no media begins even if commercial fixtures are present',async()=>{
 const {createMediaTestPlayer,mediaTestEvent,mediaTestView}=await load();
 const p=createMediaTestPlayer({baseCount:0,adCount:5});
 assert.equal(mediaTestView(p).current,null);
 assert.equal(mediaTestView(p).status,'Aguardando playlist');
 assert.equal(mediaTestView(p).included,0);
 assert.equal(mediaTestEvent(p,{type:'start'}).accepted,false);
});
test('protected customer playlist modes never receive commercials after local starts',async()=>{
 const {createMediaTestPlayer,mediaTestEvent,mediaTestView}=await load();
 for(const options of [{shuffle:true},{single:true},{scheduled:true},{enabled:false}]){
  let p=createMediaTestPlayer({...options,baseCount:6,adCount:5});
  assert.equal(mediaTestView(p).included,0);
  p=mediaTestEvent(p,{type:'start'}).player;
  for(let i=0;i<10;i++)p=mediaTestEvent(p,{type:'ended',key:mediaTestView(p).key}).player;
  assert.equal(mediaTestView(p).included,0);
  assert.deepEqual(mediaTestView(p).items.map(x=>x.id),
   ['base-1','base-2','base-3','base-4','base-5','base-6']);
 }
});
test('source, HTML and browser logic are only local and never call production APIs',()=>{
 const html=fs.readFileSync('commercial-tv-media-player.html','utf8');
 const module=fs.readFileSync('commercial-tv-media-ui.mjs','utf8');
 const core=fs.readFileSync('commercial-tv-media-controller.mjs','utf8');
 assert.match(html,/PLAYER DE TESTES — SEM TV REAL/);
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/media-src blob:/);
 assert.match(html,/type="file"/);
 assert.match(module,/URL\.createObjectURL/);
 assert.match(module,/URL\.revokeObjectURL/);
 assert.match(module,/video\.onended/);
 assert.match(module,/photo\.onload/);
 assert.match(module,/onFinish\(key\)/);
 assert.match(core,/event\.key!==now\.key/);
 for(const str of [html,module,core]){
  assert.doesNotMatch(str,/\.supabase\.co|service_role|sb_secret_|\/auth\/v1|device-gateway|\/rest\/v1\/rpc/);
 }
 for(const str of [module,core])assert.doesNotMatch(str,/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/);
});
