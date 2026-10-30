import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../player.js',import.meta.url),'utf8');
const clear=src.slice(src.indexOf('async function clearPlayerCache()'),src.indexOf('function restartPlayerRuntime()'));
const reset=src.slice(src.indexOf('function resetPairing('),src.indexOf("window.addEventListener('resize'",src.indexOf('function resetPairing(')));
test('media cache clearing never erases native command intent',async()=>{
 const storage=new Map([['vision_player_command_intent_v1','pending']]);let deleted='';
 const state={cacheItems:3,cacheBytes:100,cachePrefetchVersion:'v'};
 const ctx={state,MEDIA_CACHE:'media',caches:{delete:async key=>{deleted=key;return true;}},localStorage:{removeItem:k=>storage.delete(k)}};
 vm.createContext(ctx);vm.runInContext(clear+'\nglobalThis.clear=clearPlayerCache;',ctx);
 await ctx.clear();assert.equal(deleted,'media');assert.equal(storage.get('vision_player_command_intent_v1'),'pending');
 assert.equal(state.cacheItems,0);
});
test('explicit unpairing clears intent, acknowledgement ledger and token',()=>{
 const storage=new Map([['vision_player_command_intent_v1','pending'],['vision_player_command_ack_v1','done'],['token','token']]);
 const state={processingCommands:new Set(),deviceToken:'token',manifest:{device:{id:'old'}},playlistNonce:0};
 const ctx={state,backgroundPollState:{},window:{VisionAndroid:{}},navigator:{},localStorage:{removeItem:k=>storage.delete(k)},
 writeJson:(k,v)=>{if(v==null)storage.delete(k);},clearInterval:()=>{},clearTimeout:()=>{},
 DEVICE_TOKEN_KEY:'token',PLAYBACK_QUEUE_KEY:'playback',DEVICE_EVENT_QUEUE_KEY:'events',
 COMMAND_ACK_LEDGER_KEY:'vision_player_command_ack_v1',COMMAND_INTENT_KEY:'vision_player_command_intent_v1',
 REQUEST_METRICS_KEY:'metrics',PAIRING_KEY:'pair',MANIFEST_KEY:'manifest',
 console};
 vm.createContext(ctx);vm.runInContext(reset+'\nglobalThis.reset=resetPairing;',ctx);
 ctx.reset(false);
 assert.equal(storage.has('vision_player_command_intent_v1'),false);
 assert.equal(storage.has('vision_player_command_ack_v1'),false);
 assert.equal(storage.has('token'),false);
});
test('unresolved intent from previous TV is never mistaken for current TV',()=>{
 const s=src.slice(src.indexOf('const COMMAND_INTENT_KEY'),src.indexOf('async function pollDeviceCommands('));
 const state={manifest:{device:{id:'new-tv'}}};
 const ctx={state,readJson:()=>({device_id:'old-tv',id:'same-command',type:'update_apk',phase:'started'})};
 vm.createContext(ctx);vm.runInContext(s+'\nglobalThis.check=commandIntent;',ctx);
 assert.equal(ctx.check({id:'same-command',command_type:'update_apk'}),null);
});
