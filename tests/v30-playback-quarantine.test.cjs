const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const player=fs.readFileSync('player.js','utf8');
const start=player.indexOf('  function playbackQueue() {');
const end=player.indexOf('\n  function deviceEventQueue()',start);
assert.ok(start>0&&end>start);
const source=player.slice(start,end);
const QUEUE='queue',QUARANTINE='quarantine';
function runtime(initial,opts={}){
 const store={queue:initial.map(e=>structuredClone(e))};
 const calls=[];
 const api=vm.runInNewContext('(function(){'+source+
  '\nreturn {queuePlayback,flushPlaybackQueue,isolateInvalidPlaybackEvents,recoverQuarantinedPlaybackEvent};})()',{
  Date,Array,Set,Promise,
  PLAYBACK_QUEUE_KEY:QUEUE,
  PLAYBACK_QUARANTINE_KEY:QUARANTINE,
  state:{deviceToken:'synthetic-only'},
  navigator:{onLine:opts.online!==false},
  localStorage:{getItem(key){
    if (opts.corruptQueue && key===QUEUE) return '{invalid queue JSON';
    if (opts.corruptQuarantine && key===QUARANTINE) return '{invalid quarantine JSON';
    return store[key]==null ? null : JSON.stringify(store[key]);
  }},
  readJson:key=>store[key]??null,
  writeJson:(key,value)=>{
    if(key===QUARANTINE&&opts.failQuarantine)throw Error('simulated storage quota');
    store[key]=value;
  },
  gateway:async(request)=>{
   calls.push(structuredClone(request));
   if(opts.networkFailure)throw Error('simulated offline');
   return {ok:true,accepted:request.events.length};
  },
 },{timeout:2000});
 return {api,store,calls};
}
const valid=id=>({client_event_id:id,started_at:'2026-10-30T10:00:00Z',completed:true});
test('invalid and valid events: quarantine full proof, flush only valid, no extra request',async()=>{
 const bad={client_event_id:'',started_at:'bad',custom_metadata:{origin:'offline'}};
 const v=runtime([valid('good'),bad]);
 await v.api.flushPlaybackQueue();
 assert.equal(v.calls.length,1);
 assert.deepEqual(v.calls[0].events.map(x=>x.client_event_id),['good']);
 assert.equal(v.store.queue,null);
 assert.equal(v.store.quarantine.length,1);
 assert.deepEqual(v.store.quarantine[0].event,bad);
 assert.equal(v.store.quarantine[0].reason,'invalid_client_event_id');
});
test('over 2000: old proof preserved in local quarantine before active list shrinks',()=>{
 const v=runtime(Array.from({length:2000},(_,i)=>valid('id-'+i)));
 v.api.queuePlayback(valid('id-new'));
 assert.equal(v.store.queue.length,2000);
 assert.equal(v.store.queue[0].client_event_id,'id-1');
 assert.equal(v.store.quarantine.length,1);
 assert.equal(v.store.quarantine[0].event.client_event_id,'id-0');
 assert.equal(v.store.quarantine[0].reason,'active_queue_capacity');
});
test('quarantine storage failure leaves original pending and does not call backend',async()=>{
 const bad={client_event_id:'',started_at:'invalid'};
 const v=runtime([valid('good'),bad],{failQuarantine:true});
 await assert.rejects(v.api.flushPlaybackQueue(),/storage quota/);
 assert.equal(v.calls.length,0);
 assert.deepEqual(v.store.queue,[valid('good'),bad]);
});
test('on connectivity failure retain valid records and quarantined invalid originals',async()=>{
 const bad={client_event_id:'x'.repeat(121),started_at:'2026-10-30T10:00:00Z'};
 const v=runtime([bad,valid('still-pending')],{networkFailure:true});
 await assert.rejects(v.api.flushPlaybackQueue(),/simulated offline/);
 assert.equal(v.store.queue.length,1);
 assert.equal(v.store.queue[0].client_event_id,'still-pending');
 assert.equal(v.store.quarantine.length,1);
 assert.deepEqual(v.store.quarantine[0].event,bad);
 assert.equal(v.calls.length,1);
});
test('bad start and end dates isolated without sending them',async()=>{
 const v=runtime([
  {...valid('bad-start'),started_at:'broken'},
  {...valid('bad-end'),ended_at:'broken'},
  valid('clean')
 ]);
 await v.api.flushPlaybackQueue();
 assert.equal(v.calls.length,1);
 assert.equal(v.calls[0].events.length,1);
 assert.equal(v.store.quarantine.length,2);
 assert.deepEqual(Array.from(v.store.quarantine,e=>e.reason),['invalid_started_at','invalid_ended_at']);
});
test('offline: neither upload nor discard anything',async()=>{
 const e=valid('offline-pending');const v=runtime([e],{online:false});
 await v.api.flushPlaybackQueue();
 assert.equal(v.calls.length,0);
 assert.deepEqual(v.store.queue,[e]);
});

test('manual recovery retains entire original payload and requeues corrected event',async()=>{
 const original={client_event_id:'',started_at:'wrong',notes:'receipt-id-original'};
 const v=runtime([original]);
 await v.api.flushPlaybackQueue();
 assert.equal(v.store.quarantine.length,1);
 assert.equal(v.store.queue,null);
 const fixed={...original,client_event_id:'repaired-unique-id',started_at:'2026-10-30T10:00:00Z'};
 assert.equal(v.api.recoverQuarantinedPlaybackEvent(0,fixed),true);
 assert.equal(v.store.queue.length,1);
 assert.equal(v.store.queue[0].client_event_id,'repaired-unique-id');
 assert.equal(v.store.quarantine[0].event.notes,'receipt-id-original');
 assert.equal(v.store.quarantine[0].recovered_client_event_id,'repaired-unique-id');
 assert.ok(v.store.quarantine[0].recovered_at);
 assert.equal(v.api.recoverQuarantinedPlaybackEvent(0,fixed),false);
 await v.api.flushPlaybackQueue();
 assert.equal(v.calls.length,1);
 assert.equal(v.store.queue,null);
 assert.equal(v.store.quarantine.length,1);
});
test('refuses to requeue invalid correction without erasing original',async()=>{
 const v=runtime([{client_event_id:'',started_at:'wrong'}]);
 await v.api.flushPlaybackQueue();
 assert.throws(()=>v.api.recoverQuarantinedPlaybackEvent(0,{client_event_id:'',started_at:'bad'}),/invalid_recovery_event/);
 assert.equal(v.store.queue,null);
 assert.equal(v.store.quarantine.length,1);
 assert.equal(v.store.quarantine[0].recovered_at,undefined);
});

test('malformed queue JSON fails closed, never resets or uploads original proof',async()=>{
 const old=valid('only-local-proof');
 const v=runtime([old],{corruptQueue:true});
 await assert.rejects(v.api.flushPlaybackQueue(),/playback_storage_corrupt/);
 assert.equal(v.calls.length,0);
 assert.deepEqual(v.store.queue,[old]);
 assert.throws(()=>v.api.queuePlayback(valid('new')),/playback_storage_corrupt/);
 assert.deepEqual(v.store.queue,[old]);
});
test('malformed quarantine JSON blocks writes and preserves pending queue',async()=>{
 const bad={client_event_id:'',started_at:'bad'};
 const v=runtime([bad],{corruptQuarantine:true});
 await assert.rejects(v.api.flushPlaybackQueue(),/playback_storage_corrupt/);
 assert.equal(v.calls.length,0);
 assert.deepEqual(v.store.queue,[bad]);
});
