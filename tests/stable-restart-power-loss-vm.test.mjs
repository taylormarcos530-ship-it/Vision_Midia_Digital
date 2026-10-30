import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const player=readFileSync(new URL('player.js',root),'utf8');
const commandCode=player.slice(player.indexOf('const COMMAND_ACK_LEDGER_KEY'),player.indexOf('function acknowledgeQaBatch('));
const INTENT='vision_player_command_intent_v1',HISTORY='vision_player_command_intent_history_v1';
const cmd={id:'restart-crash',command_type:'restart_player'};
function boot(store,options={}){
 const requests=[],timers=[],events=[];
 let now=1000;
 const state={deviceToken:'token',manifest:{device:{id:options.device||'tv-A'}},processingCommands:new Set(),playlistNonce:0};
 const ctx={state,performance:{now:()=>now},navigator:{onLine:true},
  readJson:k=>JSON.parse(store.get(k)||'null'),
  writeJson:(k,v)=>{if(options.failWrite===k)throw Error('QuotaExceededError');if(options.silentWrite!==k){if(v==null)store.delete(k);else store.set(k,JSON.stringify(v));}},
  gateway:async p=>{requests.push(p);if(options.offline)throw Error('network down');if(p.action==='command_status')return {command:{id:cmd.id,device_id:options.device||'tv-A',command_type:cmd.command_type,status:options.status||'sent'}};return {ok:true};},
  queueDeviceEvent:(...args)=>events.push(args),window:{VisionAndroid:{}},
  setTimeout:(fn,ms)=>timers.push({fn,ms}),restartPlayerRuntime:()=>{events.push(['native-restart']);},
  syncManifest:async()=>{},clearPlayerCache:async()=>{},ensurePlaybackLoop:()=>{},captureCurrentFrame:async()=>({}),console};
 vm.createContext(ctx);vm.runInContext(commandCode+'\nglobalThis.poll=pollDeviceCommands;',ctx);
 return {requests,timers,events,run:()=>ctx.poll([cmd]),clock:n=>now=n};
}
test('storage failure before durable intent: no restart and no false completion',async()=>{
 const store=new Map();const h=boot(store,{failWrite:INTENT});await h.run();
 assert.equal(h.timers.length,0);assert.equal(store.has(INTENT),false);
 assert.equal(h.requests.some(r=>r.action==='command_result'&&r.status==='completed'),false);
});
test('silent write failure before restart: no native schedule',async()=>{
 const store=new Map();const h=boot(store,{silentWrite:INTENT});await h.run();
 assert.equal(h.timers.length,0);assert.equal(store.has(INTENT),false);
});
test('power cut after intent but before timer: pending restart never replayed',async()=>{
 const store=new Map([[INTENT,JSON.stringify({device_id:'tv-A',id:cmd.id,type:cmd.command_type,phase:'started'})]]);
 const h=boot(store,{status:'sent'});await h.run();
 assert.equal(h.timers.length,0);assert.equal(store.has(INTENT),true);
 assert.equal(h.requests.some(r=>r.action==='command_result'),false);
});
test('power cut after timer scheduled but before callback: restart remains ambiguous',async()=>{
 const store=new Map();const before=boot(store);await before.run();
 assert.equal(before.timers.length,1);assert.equal(before.requests.some(r=>r.action==='command_result'),false);
 const after=boot(store,{status:'sent'});await after.run();
 assert.equal(after.timers.length,0);assert.equal(store.has(INTENT),true);
});
test('after native restart callback, server pending still cannot replay',async()=>{
 const store=new Map();const before=boot(store);await before.run();
 before.timers[0].fn();
 assert.equal(before.events.filter(x=>x[0]==='native-restart').length,1);
 const after=boot(store,{status:'pending'});await after.run();
 assert.equal(after.timers.length,0);assert.equal(after.requests.some(r=>r.action==='command_result'),false);
});
test('offline reboot preserves intent and suppresses native restart',async()=>{
 const store=new Map();await boot(store).run();
 const h=boot(store,{offline:true});await h.run();
 assert.equal(h.timers.length,0);assert.equal(store.has(INTENT),true);
});
test('terminal status archives intent without replay or premature ack',async()=>{
 const store=new Map();await boot(store).run();
 const h=boot(store,{status:'completed'});await h.run();
 assert.equal(h.timers.length,0);assert.equal(store.has(INTENT),false);
 const hist=JSON.parse(store.get(HISTORY));assert.equal(hist.entries[0].server_status,'completed');
 assert.equal(h.requests.some(r=>r.action==='command_result'),false);
});
test('history quota failure preserves pending intent and existing evidence',async()=>{
 const old={version:2,entries:[{device_id:'old-tv',id:'old',type:'restart_player',server_status:'failed'}]};
 const store=new Map([[HISTORY,JSON.stringify(old)]]);
 await boot(store).run();
 const h=boot(store,{status:'completed',failWrite:HISTORY});await h.run();
 assert.equal(store.has(INTENT),true);
 assert.deepEqual(JSON.parse(store.get(HISTORY)),old);
 assert.equal(h.timers.length,0);
});
test('migration retains two old TVs and current TV',async()=>{
 const old={device_id:'tv-old-1',entries:[{id:'old-1',type:'update_apk',server_status:'completed'},{id:'old-2',device_id:'tv-old-2',type:'restart_player',server_status:'failed'}]};
 const store=new Map([[HISTORY,JSON.stringify(old)]]);
 await boot(store).run();
 await boot(store,{status:'failed'}).run();
 const h=JSON.parse(store.get(HISTORY));
 assert.equal(h.version,2);assert.equal(h.entries.length,3);
 assert.deepEqual(h.entries.map(e=>e.device_id),['tv-old-1','tv-old-2','tv-A']);
});
test('replacement TV cannot consume old device pending intent',async()=>{
 const store=new Map();await boot(store).run();
 const next=boot(store,{device:'tv-B',status:'completed'});await next.run();
 assert.equal(next.timers.length,0);assert.equal(store.has(INTENT),true);
 assert.equal(next.requests.filter(x=>x.action==='command_status').length,0);
});
for(const path of ['supabase/functions/device-gateway/index.ts','supabase/functions/device-bundle-stable/index.ts']){
 test(path+' preserves server terminal states and device scope',()=>{
  const s=readFileSync(new URL(path,root),'utf8');
  const q=s.slice(s.indexOf("if (action === 'command_status')"),s.indexOf("if (action === 'command_result')"));
  const r=s.slice(s.indexOf("if (action === 'command_result')"),s.indexOf("if (action === 'screenshot_result')"));
  assert.match(q,/\.eq\('device_id', device\.id\)/);
  assert.match(q,/\.eq\('company_id', device\.company_id\)/);
  assert.match(r,/\.in\('status', \['pending', 'sent'\]\)/);
 });
}
