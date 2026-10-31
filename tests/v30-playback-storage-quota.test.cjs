'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('player.js','utf8');
const readStart=src.indexOf('  function readJson(key) {');
const readEnd=src.indexOf('  const TRAFFIC_ACTIONS',readStart);
const queueStart=src.indexOf('  function playbackQueue() {');
const queueEnd=src.indexOf('\n  function deviceEventQueue()',queueStart);
assert.ok(readStart>0 && readEnd>readStart && queueStart>readEnd && queueEnd>queueStart);
const snippet=src.slice(readStart,readEnd)+'\n'+src.slice(queueStart,queueEnd);
const KEY='vision_player_playback_queue_v1';
const Q='vision_player_playback_quarantine_v30';
const valid=id=>({client_event_id:id,started_at:'2026-10-30T12:00:00Z',duration_seconds:15});
function setup(initial,quarantine=[],extraSpace=0){
 const map=new Map([[KEY,JSON.stringify(initial)]]);
 if(quarantine.length)map.set(Q,JSON.stringify(quarantine));
 let maxBytes=[...map].reduce((t,[k,v])=>t+k.length+v.length,0)+extraSpace;
 const storage={
  getItem(k){return map.get(k)??null},
  setItem(k,v){
   const before=map.has(k)?k.length+map.get(k).length:0;
   const after=[...map].reduce((t,[key,val])=>t+key.length+val.length,0)-before+k.length+v.length;
   if(after>maxBytes)throw Object.assign(new Error('QuotaExceededError simulated'),{name:'QuotaExceededError'});
   map.set(k,v);
  },
  removeItem(k){map.delete(k)}
 };
 const calls=[];
 const api=vm.runInNewContext('(function(){'+snippet+
   '\nreturn {queuePlayback,isolateInvalidPlaybackEvents,flushPlaybackQueue,recoverQuarantinedPlaybackEvent};})()',{
   localStorage:storage,Date,Array,Set,Promise,
   PLAYBACK_QUEUE_KEY:KEY,PLAYBACK_QUARANTINE_KEY:Q,
   state:{deviceToken:'local-QA'},navigator:{onLine:true},
   gateway:async req=>{calls.push(req);return {ok:true}},
 });
 return {map,api,calls,setLimit:(n)=>{maxBytes=n},contents:()=>new Map(map)};
}
test('full storage during quarantine: original queue unchanged; no network ACK',async()=>{
 const raw={client_event_id:'',started_at:'invalid-date',other:'full-evidence'};
 const s=setup([valid('ok'),raw],[],0);
 await assert.rejects(s.api.flushPlaybackQueue(),/QuotaExceededError/);
 assert.deepEqual(JSON.parse(s.map.get(KEY)),[valid('ok'),raw]);
 assert.equal(s.map.has(Q),false);
 assert.equal(s.calls.length,0);
});
test('full storage during 2001st event: 2000 original events preserved, enqueue throws',()=>{
 const old=Array.from({length:2000},(_,i)=>valid('ev-'+i));
 const s=setup(old,[],0);
 assert.throws(()=>s.api.queuePlayback(valid('new')),/QuotaExceededError/);
 assert.deepEqual(JSON.parse(s.map.get(KEY)),old);
 assert.equal(s.map.has(Q),false);
 assert.equal(s.calls.length,0);
});
test('recovery with quota failure retains original quarantined and fails loudly',()=>{
 const original={client_event_id:'',started_at:'bad',note:'immutable receipt'};
 const quarantined=[{event:original,reason:'invalid_client_event_id',quarantined_at:'2026-10-30T12:00:00Z'}];
 const fix=valid('corrected');
 const s=setup([],quarantined,JSON.stringify([fix]).length+KEY.length+30);
 // Quarantine record grows by recovered_at + recovered_client_event_id.
 assert.throws(()=>s.api.recoverQuarantinedPlaybackEvent(0,fix),/QuotaExceededError/);
 assert.deepEqual(JSON.parse(s.map.get(Q)),quarantined);
 assert.deepEqual(JSON.parse(s.map.get(KEY)),[fix]);
});
test('offline with full storage never discards already persisted proofs',async()=>{
 const old=[valid('offline-proof')];
 const s=setup(old,[],0);
 assert.deepEqual(JSON.parse(s.map.get(KEY)),old);
 assert.equal(s.calls.length,0);
});
