import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../player.js',import.meta.url),'utf8');
const gate=src.slice(src.indexOf('async function runBackgroundPoll(task)'),src.indexOf('function replaceNodeChildren('));
const bundle=src.slice(src.indexOf('async function runQaBundle()'),src.indexOf('function shuffled('));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function setup(){
 const state={deviceToken:'token',manifest:{device:{id:'tv-1'}},qaLastManifestAt:100,qaBundleSupported:true,pushPending:false,pushSignalGeneration:0};
 const poll={inFlight:false,failures:0,retryAt:0};
 let now=1000,requests=0,network=true,queued=[{client_event_id:'event-a'}],commands=[];
 const ctx={state,navigator:{get onLine(){return network;}},backgroundPollState:poll,
 performance:{now:()=>now},Math:Object.assign(Object.create(Math),{random:()=>0}),
 BACKGROUND_RETRY_MAX_MS:300000,BACKGROUND_RETRY_BASE_MS:15000,
 isAccessError:()=>false,STABLE_BUNDLE_VERSION:'1.5.24-stable',
 QA_BUNDLE_MANIFEST_INTERVAL_MS:120000,PLAYBACK_QUEUE_KEY:'proofs',DEVICE_EVENT_QUEUE_KEY:'events',
 nativeAppVersion:()=> '1.5.24-stable',useQaBundle:()=>true,
 playbackQueue:()=>[],deviceEventQueue:()=>queued,
 heartbeat:async()=>({ok:true}),countRequestAttempt:()=>{},functionRequest:async()=>{requests++;return {ok:true,device_id:'tv-1',commands:{ok:true,data:{commands}},heartbeat:{ok:true},events:{ok:true,data:{accepted:queued.length}},proofs:{ok:true,data:{accepted:0}}};},
 acknowledgeQaBatch:()=>{queued=[];},pollDeviceCommands:async()=>{},syncManifest:async()=>{},
 resetPairing:()=>{},startPairing:()=>{},showAccessBlocked:()=>{},startLegacyPollingTimers:()=>{},
 console
 };
 vm.createContext(ctx);
 vm.runInContext(gate+'\n'+bundle+'\nglobalThis.__gate=runBackgroundPoll;globalThis.__bundle=runQaBundle;',ctx);
 return {ctx,state,poll,setNow:v=>now=v,setOnline:v=>network=v,setRequest:fn=>ctx.functionRequest=fn,requests:()=>requests,queue:()=>queued};
}
test('inFlight suppresses simultaneous reconnect focus and push requests',async()=>{
 const h=setup(),pending=deferred();h.setRequest(async()=>{pending.resolve;return pending.promise;});
 const first=h.ctx.__gate(h.ctx.__bundle);
 const other=await Promise.all([h.ctx.__gate(h.ctx.__bundle),h.ctx.__gate(h.ctx.__bundle),h.ctx.__gate(h.ctx.__bundle)]);
 assert.deepEqual(other,[false,false,false]);assert.equal(h.poll.inFlight,true);
 pending.resolve({ok:true,device_id:'tv-1',commands:{ok:true,data:{commands:[]}},heartbeat:{ok:true},events:{ok:true,data:{accepted:1}},proofs:{ok:true,data:{accepted:0}}});
 assert.equal(await first,true);assert.equal(h.poll.inFlight,false);
});
test('backoff prevents repeated calls until retry deadline',async()=>{
 const h=setup();let attempts=0;
 h.setRequest(async()=>{attempts++;throw new Error('offline server');});
 assert.equal(await h.ctx.__gate(h.ctx.__bundle),false);
 assert.equal(attempts,1);assert.equal(h.poll.retryAt,16000);
 h.setNow(15999);assert.equal(await h.ctx.__gate(h.ctx.__bundle),false);assert.equal(attempts,1);
 h.setNow(16000);assert.equal(await h.ctx.__gate(h.ctx.__bundle),false);assert.equal(attempts,2);
 assert.equal(h.poll.retryAt,46000);
});
test('new push during pending request survives acknowledged earlier cycle',async()=>{
 const h=setup(),pending=deferred();h.state.pushPending=true;h.state.pushSignalGeneration=1;
 h.setRequest(async()=>pending.promise);
 const first=h.ctx.__gate(h.ctx.__bundle);
 h.state.pushSignalGeneration=2;h.state.pushPending=true;
 pending.resolve({ok:true,device_id:'tv-1',commands:{ok:true,data:{commands:[]}},heartbeat:{ok:true},events:{ok:true,data:{accepted:1}},proofs:{ok:true,data:{accepted:0}}});
 assert.equal(await first,true);assert.equal(h.state.pushPending,true);
 assert.equal(await h.ctx.__gate(h.ctx.__bundle),true);assert.equal(h.state.pushPending,false);
});
test('failure preserves queued proofs and push for retry',async()=>{
 const h=setup();h.state.pushPending=true;h.state.pushSignalGeneration=1;
 h.setRequest(async()=>{throw new Error('network timeout');});
 assert.equal(await h.ctx.__gate(h.ctx.__bundle),false);
 assert.equal(h.state.pushPending,true);assert.equal(h.queue().length,1);
});
test('network offline skips requests without changing cache queue',async()=>{
 const h=setup();h.setOnline(false);assert.equal(await h.ctx.__gate(h.ctx.__bundle),false);assert.equal(h.requests(),0);assert.equal(h.queue().length,1);
});
