import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../player.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('const COMMAND_ACK_LEDGER_KEY'),source.indexOf('function acknowledgeQaBatch('));
function fixture(status,device='tv'){
 const store=new Map();
 store.set('vision_player_command_intent_v1',JSON.stringify({device_id:'tv',id:'cmd',type:'update_apk',phase:'started'}));
 const effects={apk:0},requests=[];
 const state={deviceToken:'token',manifest:{device:{id:device}},processingCommands:new Set()};
 let clock=1000;const ctx={state,performance:{now:()=>clock},navigator:{onLine:true},readJson:k=>JSON.parse(store.get(k)||'null'),
 writeJson:(k,v)=>{if(v==null)store.delete(k);else store.set(k,JSON.stringify(v));},
 gateway:async p=>{requests.push(p);if(p.action==='command_status')return {ok:true,command:{id:'cmd',device_id:'tv',command_type:'update_apk',status}};return {ok:true};},
 queueDeviceEvent:()=>{},window:{VisionAndroid:{requestApkUpdate:()=>{effects.apk++;return true;}}},console};
 vm.createContext(ctx);vm.runInContext(code+'\nglobalThis.poll=pollDeviceCommands;',ctx);
 return {store,effects,requests,setClock:v=>clock=v,run:()=>ctx.poll([{id:'cmd',command_type:'update_apk'}])};
}
for(const status of ['pending','sent']){
 test(status+' retains uncertain intent and never replays APK',async()=>{
  const h=fixture(status);await h.run();
  assert.equal(h.effects.apk,0);
  assert.equal(h.store.has('vision_player_command_intent_v1'),true);
  assert.equal(h.requests.filter(x=>x.action==='command_status').length,1);
 });
}
for(const status of ['completed','failed']){
 test(status+' archives evidence then clears blocking intent without replay',async()=>{
  const h=fixture(status);await h.run();
  assert.equal(h.effects.apk,0);
  assert.equal(h.store.has('vision_player_command_intent_v1'),false);
  const history=JSON.parse(h.store.get('vision_player_command_intent_history_v1'));
  assert.equal(history.entries[0].server_status,status);\n  assert.equal(history.entries[0].device_id,'tv');
 });
}
test('old device identity cannot be reconciled using new TV token',async()=>{
 const h=fixture('completed','new-tv');await h.run();
 assert.equal(h.effects.apk,0);
 assert.equal(h.store.has('vision_player_command_intent_v1'),true);
 assert.equal(h.requests.filter(x=>x.action==='command_status').length,0);
});
for(const path of ['supabase/functions/device-gateway/index.ts','supabase/functions/device-bundle-stable/index.ts']){
 test(path+' status endpoint is read-only and device scoped',()=>{
  const s=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const p=s.slice(s.indexOf("if (action === 'command_status')"),s.indexOf("if (action === 'command_result')"));
  assert.match(p,/\.eq\('device_id', device\.id\)/);
  assert.match(p,/\.eq\('company_id', device\.company_id\)/);
  assert.doesNotMatch(p,/\.update\(|\.insert\(|\.delete\(/);
 });
}

test('repeated pending status is throttled for five minutes',async()=>{
 const h=fixture('sent');await h.run();await h.run();await h.run();
 assert.equal(h.requests.filter(x=>x.action==='command_status').length,1);
 h.setClock(301001);await h.run();
 assert.equal(h.requests.filter(x=>x.action==='command_status').length,2);
});
test('contradictory server identity cannot archive or release intent',async()=>{
 const h=fixture('completed','new-tv');await h.run();
 assert.equal(h.store.has('vision_player_command_intent_v1'),true);
 assert.equal(h.store.has('vision_player_command_intent_history_v1'),false);
});
test('terminal archive is not overwritten by stale command replay',async()=>{
 const h=fixture('completed');await h.run();
 const history=h.store.get('vision_player_command_intent_history_v1');
 await h.run();
 assert.equal(h.effects.apk,0);
 assert.equal(h.store.get('vision_player_command_intent_history_v1'),history);
});

test('legacy history migration preserves old TV and new TV evidence',async()=>{
 const h=fixture('completed');
 h.store.set('vision_player_command_intent_history_v1',JSON.stringify({
   device_id:'previous-tv',entries:[{id:'old',type:'restart_player',server_status:'failed'}]
 }));
 await h.run();
 const history=JSON.parse(h.store.get('vision_player_command_intent_history_v1'));
 assert.equal(history.version,2);
 assert.equal(history.entries.length,2);
 assert.equal(history.entries[0].device_id,'previous-tv');
 assert.equal(history.entries[1].device_id,'tv');
});
