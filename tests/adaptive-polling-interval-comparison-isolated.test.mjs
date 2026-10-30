import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createAdaptiveCommandPoller} from './fixtures/adaptive-command-poller-proposal.mjs'

const player=readFileSync(new URL('../player.js',import.meta.url),'utf8')
function clock(){
 let now=0,seq=0;const tasks=new Map()
 return {
  now:()=>now, pending:()=>tasks.size,
  schedule:(fn,ms)=>{const id=++seq;tasks.set(id,{at:now+ms,fn});return id},
  cancel:id=>tasks.delete(id),
  async advance(ms){
   const end=now+ms
   for(let i=0;i<100000;i++){
    const next=[...tasks.entries()].sort((a,b)=>a[1].at-b[1].at)[0]
    if(!next||next[1].at>end)break
    now=next[1].at;tasks.delete(next[0]);next[1].fn()
    for(let j=0;j<10;j++)await Promise.resolve()
   }
   now=end
  }
 }
}
function setup(idleMs,{commands=()=>0,online=true,poll}={}){
 const c=clock(),calls=[];let connected=online
 const scheduler=createAdaptiveCommandPoller({
  idleMs,now:c.now,schedule:c.schedule,cancel:c.cancel,
  online:()=>connected,
  poll:poll|| (async()=>{calls.push(c.now());return {commandsFound:commands(c.now())}})
 })
 return {c,calls,scheduler,network:value=>{connected=value;scheduler.networkChanged()}}
}
for(const idleMs of [10000,15000,30000]){
 test(`idle ${idleMs}ms: requests/day and worst-case detection delay`,async()=>{
  const h=setup(idleMs);h.scheduler.start();await h.c.advance(86400000-1)
  assert.equal(h.calls.length,Math.ceil(86400000/idleMs))
  assert.equal(h.calls[0],0)
  assert.equal(h.calls.at(-1),(h.calls.length-1)*idleMs)
  h.scheduler.stop();assert.equal(h.c.pending(),0)
 })
 test(`screenshot ${idleMs}ms: idle detection then active cadence`,async()=>{
  const arrival=1
  const h=setup(idleMs,{commands:t=>t>=arrival&&t<idleMs+1?1:0})
  h.scheduler.start();await h.c.advance(idleMs)
  assert.deepEqual(h.calls,[0,idleMs])
  const detectedAt=h.calls.find(t=>t>=arrival)
  assert.equal(detectedAt-arrival,idleMs-1)
  await h.c.advance(5000)
  assert.equal(h.calls.at(-1),idleMs+5000)
  h.scheduler.stop()
 })
 test(`reconnection ${idleMs}ms: immediate one poll, no duplicate timers`,async()=>{
  const h=setup(idleMs,{online:false});h.scheduler.start()
  await h.c.advance(60000);assert.equal(h.calls.length,0)
  h.network(true);h.network(true);await h.c.advance(0)
  assert.deepEqual(h.calls,[60000]);assert.equal(h.c.pending(),1)
  h.network(false);await h.c.advance(idleMs*2)
  assert.equal(h.calls.length,1);assert.equal(h.c.pending(),0)
  h.scheduler.stop()
 })
 test(`restart ${idleMs}ms: no ghost polls`,async()=>{
  const h=setup(idleMs);h.scheduler.start();await h.c.advance(0)
  h.scheduler.stop();await h.c.advance(idleMs*2)
  assert.deepEqual(h.calls,[0])
  h.scheduler.start();await h.c.advance(0)
  assert.deepEqual(h.calls,[0,idleMs*2]);h.scheduler.stop()
  assert.equal(h.c.pending(),0)
 })
 test(`gateway rejection ${idleMs}ms: 30s backoff, no rapid retries`,async()=>{
  const c=clock(),calls=[]
  const scheduler=createAdaptiveCommandPoller({
   idleMs,online:()=>true,now:c.now,schedule:c.schedule,cancel:c.cancel,
   poll:async()=>{calls.push(c.now());throw Error('gateway timeout/rejection')}
  })
  scheduler.start();await c.advance(60000)
  assert.deepEqual(calls,[0,30000,60000]);scheduler.stop()
 })
}
test('comparison remains isolated from player, screenshot ACK and cache',()=>{
 assert.match(player,/state\.commandTimer = setInterval\(\(\) => pollDeviceCommands\(\)\.catch\(\(\) => \{\}\), 5_000\)/)
 assert.match(player,/SCREENSHOT_ACK_KEY/)
 assert.match(player,/screenshot_result/)
 assert.match(player,/cacheManifestAssets/)
 assert.doesNotMatch(player,/adaptive-command-poller-proposal/)
})
test('hung gateway promise is a known integration blocker (no native timeout)',async()=>{
 const c=clock();let started=0
 const scheduler=createAdaptiveCommandPoller({
  idleMs:15000,online:()=>true,now:c.now,schedule:c.schedule,cancel:c.cancel,
  poll:()=>{started++;return new Promise(()=>{})}
 })
 scheduler.start();await c.advance(0);await c.advance(120000)
 assert.equal(started,1)
 assert.equal(scheduler.state.inFlight,true)
 scheduler.stop()
})
