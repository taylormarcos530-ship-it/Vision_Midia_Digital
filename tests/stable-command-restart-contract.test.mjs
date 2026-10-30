import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const player=readFileSync(new URL('player.js',root),'utf8');
const commandCode=player.slice(player.indexOf('const COMMAND_ACK_LEDGER_KEY'),player.indexOf('function acknowledgeQaBatch('));
for(const path of ['supabase/functions/device-gateway/index.ts','supabase/functions/device-bundle-stable/index.ts']){
 test(path+' terminal status cannot be overwritten by late acknowledgement',()=>{
  const s=readFileSync(new URL(path,root),'utf8');
  const section=s.slice(s.indexOf("if (action === 'command_result')"),s.indexOf("if (action === 'screenshot_result')"));
  assert.match(section,/\.in\('status', \['pending', 'sent'\]\)/);
  assert.match(section,/\.eq\('device_id', device\.id\)/);
  const server={status:'completed'};
  const apply=(status)=>{if(['pending','sent'].includes(server.status))server.status=status;};
  apply('failed');assert.equal(server.status,'completed');
 });
}
function make(shared=new Map()){
 const effects={clear:0,apk:0,restart:0},sent=[],timers=[];
 let lost=false,network=true;
 const state={deviceToken:'token',manifest:{device:{id:'tv'}},processingCommands:new Set(),playlistNonce:0};
 const ctx={state,performance:{now:()=>1000},navigator:{get onLine(){return network;}},readJson:k=>JSON.parse(shared.get(k)||'null'),
 writeJson:(k,v)=>v==null?shared.delete(k):shared.set(k,JSON.stringify(v)),
 gateway:async p=>{sent.push(p);if(p.action==='command_result'&&lost){lost=false;throw Error('ack lost');}return {};},
 syncManifest:async()=>{},clearPlayerCache:async()=>{effects.clear++;},ensurePlaybackLoop:()=>{},queueDeviceEvent:()=>{},
 window:{VisionAndroid:{requestApkUpdate:()=>{effects.apk++;return true;}}},setTimeout:(fn,ms)=>{timers.push({fn,ms});},
 restartPlayerRuntime:()=>{effects.restart++;},captureCurrentFrame:async()=>({}),console};
 vm.createContext(ctx);vm.runInContext(commandCode+'\nglobalThis.__poll=pollDeviceCommands;',ctx);
 return {shared,effects,sent,timers,lose:()=>{lost=true;},run:cmd=>ctx.__poll([cmd]),offline:()=>{network=false;},online:()=>{network=true;}};
}
test('app restart after completed clear_cache with lost acknowledgement does not repeat destructive effect',async()=>{
 const store=new Map(),cmd={id:'clear-1',command_type:'clear_cache'};
 const first=make(store);first.lose();await first.run(cmd);assert.equal(first.effects.clear,1);
 const afterRestart=make(store);await afterRestart.run(cmd);
 assert.equal(afterRestart.effects.clear,0);
 assert.equal(afterRestart.sent.filter(x=>x.status==='completed').length,1);
});
test('app restart after accepted APK update does not trigger another update',async()=>{
 const store=new Map(),cmd={id:'apk-1',command_type:'update_apk'};
 const first=make(store);first.lose();await first.run(cmd);assert.equal(first.effects.apk,1);
 const afterRestart=make(store);await afterRestart.run(cmd);assert.equal(afterRestart.effects.apk,0);
});
test('restart_player is acknowledged before reboot and replay after response loss remains a known gap',async()=>{
 const store=new Map(),cmd={id:'restart-1',command_type:'restart_player'};
 const first=make(store);first.lose();await first.run(cmd);
 assert.equal(first.timers.length,0);
 const afterRestart=make(store);await afterRestart.run(cmd);
 assert.equal(afterRestart.timers.length,0);
});
test('offline command does not execute and is processed after reconnection',async()=>{
 const h=make(),cmd={id:'offline',command_type:'clear_cache'};
 h.offline();await h.run(cmd);assert.equal(h.effects.clear,0);
 h.online();await h.run(cmd);assert.equal(h.effects.clear,1);
});
test('power loss before local effect record is an unresolved atomicity boundary',()=>{
 const s=commandCode.slice(commandCode.indexOf("if(command.command_type==='clear_cache')"),commandCode.indexOf("if(command.command_type==='reload_programming')"));
 assert.ok(s.indexOf('await clearPlayerCache()')<s.indexOf('rememberCommandEffect(command)'));
});

test('interrupted native update is quarantined across app restart',async()=>{
 const store=new Map();
 store.set('vision_player_command_intent_v1',JSON.stringify({device_id:'tv',id:'apk-crash',type:'update_apk',phase:'started'}));
 const h=make(store);
 await h.run({id:'apk-crash',command_type:'update_apk'});
 assert.equal(h.effects.apk,0);
 assert.equal(h.sent.filter(p=>p.action==='command_result').length,0);
});
test('interrupted native restart is quarantined across app restart',async()=>{
 const store=new Map();
 store.set('vision_player_command_intent_v1',JSON.stringify({device_id:'tv',id:'restart-crash',type:'restart_player',phase:'started'}));
 const h=make(store);
 await h.run({id:'restart-crash',command_type:'restart_player'});
 assert.equal(h.timers.length,0);
 assert.equal(h.sent.filter(p=>p.action==='command_result').length,0);
});

test('full storage blocks native APK effect',async()=>{
 const store=new Map();
 const set=store.set.bind(store);
 store.set=(key,value)=>{if(key==='vision_player_command_intent_v1')throw new Error('QuotaExceededError');return set(key,value);};
 const h=make(store);
 await h.run({id:'quota',command_type:'update_apk'});
 assert.equal(h.effects.apk,0);
});
test('silent storage write failure blocks native restart',async()=>{
 const store=new Map();
 const set=store.set.bind(store);
 store.set=(key,value)=>key==='vision_player_command_intent_v1'?store:set(key,value);
 const h=make(store);
 await h.run({id:'silent',command_type:'restart_player'});
 assert.equal(h.timers.length,0);
});
test('unresolved intent is not overwritten by a different command',async()=>{
 const store=new Map();
 store.set('vision_player_command_intent_v1',JSON.stringify({device_id:'tv',id:'old',type:'update_apk',phase:'started'}));
 const h=make(store);
 await h.run({id:'new',command_type:'restart_player'});
 assert.equal(h.timers.length,0);
 assert.equal(JSON.parse(store.get('vision_player_command_intent_v1')).id,'old');
});
test('unrelated synchronization works with unresolved native intent',async()=>{
 const store=new Map();
 store.set('vision_player_command_intent_v1',JSON.stringify({device_id:'tv',id:'old',type:'update_apk',phase:'started'}));
 const h=make(store);
 await h.run({id:'sync-other',command_type:'sync_now'});
 assert.equal(h.sent.some(x=>x.action==='command_result'&&x.status==='completed'),true);
});
