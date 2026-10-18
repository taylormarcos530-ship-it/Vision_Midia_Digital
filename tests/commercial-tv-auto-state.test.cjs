const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const load=()=>import('../commercial-tv-auto-state.mjs');

test('a completed item advances exactly once and a duplicate callback is ignored',async()=>{
 const {createAutoBench,autoBenchView,advanceAutoBench}=await load();
 const original=createAutoBench({baseCount:6,adCount:5});
 const token=autoBenchView(original).token;
 const next=advanceAutoBench(original,{type:'complete',token});
 assert.equal(next.accepted,true);
 assert.equal(original.position,0,'immutable state');
 assert.equal(next.state.position,1);
 assert.equal(next.state.cycle,0);
 const duplicate=advanceAutoBench(next.state,{type:'complete',token});
 assert.equal(duplicate.accepted,false);
 assert.equal(duplicate.state.position,1);
 assert.equal(duplicate.state.completedItems,1);
});
test('five automatic completion-driven cycles rotate five creatives evenly without stacked ads',async()=>{
 const {createAutoBench,autoBenchView,advanceAutoBench}=await load();
 let state=createAutoBench({baseCount:6,adCount:5}),counts=new Map();
 for(let cycle=0;cycle<5;cycle++){
  const view=autoBenchView(state);
  assert.equal(view.cycle,cycle);
  assert.equal(view.items.length,8);
  assert.equal(view.included,2);
  assert.deepEqual(view.items.filter(x=>!x.commercial).map(x=>x.id),
   ['base-1','base-2','base-3','base-4','base-5','base-6']);
  for(let i=1;i<view.items.length;i++)
   assert.ok(!(view.items[i-1].commercial&&view.items[i].commercial));
  for(const ad of view.items.filter(x=>x.commercial))
   counts.set(ad.id,(counts.get(ad.id)||0)+1);
  for(let i=0;i<view.items.length;i++){
   const pending=autoBenchView(state);
   const next=advanceAutoBench(state,{type:'complete',token:pending.token});
   assert.equal(next.accepted,true);
   state=next.state;
  }
 }
 assert.equal(state.cycle,5);
 assert.equal(state.completedCycles,5);
 assert.equal(state.completedItems,40);
 assert.deepEqual(Object.fromEntries([...counts].sort()),{
  'commercial-1':2,'commercial-2':2,'commercial-3':2,'commercial-4':2,'commercial-5':2
 });
});
test('lost connection pauses progression and reconnection resumes same media once',async()=>{
 const {createAutoBench,autoBenchView,advanceAutoBench}=await load();
 let state=createAutoBench({baseCount:6,adCount:5});
 const initial=autoBenchView(state).token;
 state=advanceAutoBench(state,{type:'disconnect'}).state;
 assert.equal(autoBenchView(state).position,0);
 assert.equal(advanceAutoBench(state,{type:'complete',token:initial}).accepted,false);
 assert.equal(autoBenchView(state).current.id,'base-1');
 state=advanceAutoBench(state,{type:'reconnect'}).state;
 assert.equal(state.position,0);
 assert.equal(state.cycle,0);
 assert.notEqual(autoBenchView(state).token,initial,'stale callbacks are invalidated');
 assert.equal(advanceAutoBench(state,{type:'complete',token:initial}).accepted,false);
 const accepted=advanceAutoBench(state,{type:'complete',token:autoBenchView(state).token});
 assert.equal(accepted.accepted,true);
 assert.equal(accepted.state.position,1);
});
test('refresh preserves cycle and position, rejects late completion, never repeats the old step',async()=>{
 const {createAutoBench,autoBenchView,advanceAutoBench}=await load();
 let state=createAutoBench({baseCount:6,adCount:5});
 state=advanceAutoBench(state,{type:'complete',token:autoBenchView(state).token}).state;
 const before=autoBenchView(state),old=before.token;
 state=advanceAutoBench(state,{type:'refresh'}).state;
 const after=autoBenchView(state);
 assert.equal(after.position,before.position);
 assert.equal(after.cycle,before.cycle);
 assert.equal(after.current.id,before.current.id);
 assert.notEqual(after.token,old);
 assert.equal(advanceAutoBench(state,{type:'complete',token:old}).accepted,false);
 assert.equal(advanceAutoBench(state,{type:'complete',token:after.token}).state.position,2);
});
test('checkpoint handoff models restart preserving progress but invalidating callbacks',async()=>{
 const {createAutoBench,autoBenchView,advanceAutoBench,restoreAutoBench}=await load();
 let state=createAutoBench({baseCount:6,adCount:5});
 for(let i=0;i<9;i++)state=advanceAutoBench(state,{type:'complete',token:autoBenchView(state).token}).state;
 assert.equal(state.cycle,1);
 assert.equal(state.position,1);
 const old=autoBenchView(state).token;
 const checkpoint=JSON.parse(JSON.stringify(state));
 const restored=restoreAutoBench(checkpoint);
 assert.equal(restored.accepted,true);
 assert.equal(restored.state.cycle,1);
 assert.equal(restored.state.position,1);
 assert.deepEqual(restored.state.options,state.options);
 assert.notEqual(autoBenchView(restored.state).token,old);
 assert.equal(advanceAutoBench(restored.state,{type:'complete',token:old}).accepted,false);
 const reboot=advanceAutoBench(state,{type:'restart'});
 assert.equal(reboot.accepted,true);
 assert.equal(reboot.state.cycle,1);
 assert.equal(reboot.state.position,1);
});
test('bad snapshot fails closed without ads; no playlist never advances',async()=>{
 const {createAutoBench,autoBenchView,advanceAutoBench,restoreAutoBench}=await load();
 for(const invalid of [null,{}, {version:1}, {...createAutoBench(),position:100},
  {...createAutoBench(),cycle:-1}, {...createAutoBench(),connected:'false'}]){
  const safe=restoreAutoBench(invalid);
  assert.equal(safe.accepted,false);
  assert.equal(autoBenchView(safe.state).included,0);
 }
 let state=createAutoBench({baseCount:0,adCount:5});
 const view=autoBenchView(state);
 assert.equal(view.status,'Aguardando playlist');
 assert.equal(view.token,null);
 const noAdvance=advanceAutoBench(state,{type:'complete',token:null});
 assert.equal(noAdvance.accepted,false);
 assert.equal(noAdvance.state.cycle,0);
});
test('configuration change preserves cycle number but invalidates old media callbacks',async()=>{
 const {createAutoBench,autoBenchView,advanceAutoBench}=await load();
 let state=createAutoBench({baseCount:6,adCount:5});
 for(let i=0;i<8;i++)state=advanceAutoBench(state,{type:'complete',token:autoBenchView(state).token}).state;
 assert.equal(state.cycle,1);
 const previous=autoBenchView(state).token;
 state=advanceAutoBench(state,{type:'configure',options:{baseCount:3,adCount:2,shuffle:true}}).state;
 assert.equal(state.cycle,1);assert.equal(state.position,0);
 assert.equal(autoBenchView(state).included,0);
 assert.equal(advanceAutoBench(state,{type:'complete',token:previous}).accepted,false);
 assert.deepEqual(autoBenchView(state).items.map(item=>item.id),['base-1','base-2','base-3']);
});
test('protected playlist modes never gain commercial items while advancing',async()=>{
 const {createAutoBench,autoBenchView,advanceAutoBench}=await load();
 for(const config of [{shuffle:true},{single:true},{scheduled:true},{enabled:false},{adCount:0}]){
  let state=createAutoBench({...config,baseCount:6,adCount:config.adCount??5});
  for(let i=0;i<14;i++){
   const v=autoBenchView(state);
   assert.equal(v.included,0);
   assert.deepEqual(v.items.map(item=>item.id),['base-1','base-2','base-3','base-4','base-5','base-6']);
   state=advanceAutoBench(state,{type:'complete',token:v.token}).state;
  }
 }
});
test('automatic bench stays offline and independent from the opt-in live rotation gateway',()=>{
 const src=fs.readFileSync('commercial-tv-auto-state.mjs','utf8');
 assert.match(src,/simulateBench/);
 assert.match(src,/event\.type==='complete'/);
 assert.match(src,/event\.token!==view\.token/);
 assert.match(src,/restoreAutoBench/);
 assert.doesNotMatch(src,/fetch\(|createClient\(|supabase\.co|\.rpc\(|localStorage|sessionStorage|service_role/);
 const gateway=fs.readFileSync('supabase/functions/_shared/commercial.mjs','utf8');
 assert.doesNotMatch(gateway,/commercial-tv-auto-state/,'local simulation cannot be imported by operational gateway');
 assert.match(gateway,/export async function augmentCommercial\(admin,device,primary,supportsSchedules,enabled,timeZone='America\/Sao_Paulo',commercialCycle=0\)/);
 assert.match(gateway,/return interleave\(primary,ads,3,commercialCycle\)/,'isolated Player now selects the next complete cycle');
});
