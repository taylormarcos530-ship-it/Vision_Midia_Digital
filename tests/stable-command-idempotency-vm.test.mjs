import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../player.js',import.meta.url),'utf8');
const part=source.slice(source.indexOf('const COMMAND_ACK_LEDGER_KEY'),source.indexOf('function acknowledgeQaBatch('));
function harness(){
 const storage=new Map(),effects={sync:0,clear:0,reload:0,apk:0},sent=[];
 let loseAck=false,online=true,device='tv-1';
 const state={deviceToken:'token',manifest:{device:{id:device}},processingCommands:new Set(),playlistNonce:0};
 const ctx={state,navigator:{get onLine(){return online;}},localStorage:{removeItem:k=>storage.delete(k)},
 readJson:k=>JSON.parse(storage.get(k)||'null'),writeJson:(k,v)=>v==null?storage.delete(k):storage.set(k,JSON.stringify(v)),
 gateway:async p=>{sent.push(p);if(p.action==='command_result'&&loseAck){loseAck=false;throw Error('response lost');}return {};},
 syncManifest:async()=>{effects.sync++;},clearPlayerCache:async()=>{effects.clear++;},
 ensurePlaybackLoop:()=>{effects.reload++;},queueDeviceEvent:()=>{},
 captureCurrentFrame:async()=>({}),restartPlayerRuntime:()=>{},
 window:{VisionAndroid:{requestApkUpdate:()=>{effects.apk++;return true;}}},
 setTimeout:()=>{},console
 };
 vm.createContext(ctx);
 vm.runInContext(part+'\nglobalThis.__poll=pollDeviceCommands;',ctx);
 return {state,storage,effects,sent,run:cmd=>ctx.__poll([cmd]),lose:()=>{loseAck=true;},offline:()=>{online=false;},online:()=>{online=true;},setDevice:d=>{state.manifest.device.id=d;}};
}
for(const type of ['sync_now','clear_cache','reload_programming','update_apk']){
 test(type+' response lost after effect: replay only acknowledges',async()=>{
  const h=harness(),cmd={id:'command-1',command_type:type};
  h.lose();await h.run(cmd);
  const snapshot=JSON.stringify(h.effects);
  await h.run(cmd);
  assert.equal(JSON.stringify(h.effects),snapshot);
  assert.equal(h.sent.filter(p=>p.action==='command_result'&&p.status==='completed').length,2);
  assert.equal(h.sent.filter(p=>p.status==='failed').length,0);
 });
}
test('offline queue stays server-side until reconnection',async()=>{
 const h=harness(),cmd={id:'offline',command_type:'sync_now'};
 h.offline();await h.run(cmd);assert.equal(h.effects.sync,0);
 h.online();await h.run(cmd);assert.equal(h.effects.sync,1);
});
test('ledger is scoped to device id',async()=>{
 const h=harness(),cmd={id:'same-id',command_type:'sync_now'};
 await h.run(cmd);h.setDevice('tv-2');await h.run(cmd);assert.equal(h.effects.sync,2);
});
test('failed side effect can retry, no premature completed ledger',async()=>{
 const h=harness(),cmd={id:'clear-fail',command_type:'clear_cache'};
 h.state.deviceToken=null;await h.run(cmd);assert.equal(h.effects.clear,0);
 h.state.deviceToken='token';await h.run(cmd);assert.equal(h.effects.clear,1);
});
