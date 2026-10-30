import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createAdaptiveCommandPoller} from './fixtures/adaptive-command-poller-proposal.mjs'

const player=readFileSync(new URL('../player.js',import.meta.url),'utf8')
function clock() {
  let time=0,seq=0
  const tasks=new Map()
  return {
    now:()=>time,
    schedule:(fn,delay)=>{const id=++seq;tasks.set(id,{at:time+delay,fn});return id},
    cancel:id=>tasks.delete(id),
    async advance(ms) {
      const end=time+ms
      for(let i=0;i<100000;i++){
        const next=[...tasks.entries()].sort((a,b)=>a[1].at-b[1].at)[0]
        if(!next||next[1].at>end)break
        time=next[1].at;tasks.delete(next[0]);next[1].fn()
        for(let j=0;j<8;j++)await Promise.resolve()
      }
      time=end
    },
    count:()=>tasks.size
  }
}
function harness({commands=()=>0,online=true,poll}={}) {
  const c=clock(),calls=[]
  let connected=online
  const scheduler=createAdaptiveCommandPoller({
    poll:poll||(async()=>{calls.push(c.now());return {commandsFound:commands(c.now())}}),
    online:()=>connected,schedule:c.schedule,cancel:c.cancel,now:c.now
  })
  return {c,calls,scheduler,setOnline:value=>{connected=value;scheduler.networkChanged()}}
}
test('proposal is not imported by live player and existing 5-second interval remains',()=>{
  assert.doesNotMatch(player,/adaptive-command-poller-proposal/)
  assert.match(player,/state\.commandTimer = setInterval\(\(\) => pollDeviceCommands\(\)\.catch\(\(\) => \{\}\), 5_000\)/)
})
test('idle poller makes 2880 requests per 24h (excluding boundary) without overlaps',async()=>{
  const h=harness();h.scheduler.start();await h.c.advance(86400000-1)
  assert.equal(h.calls.length,2880);h.scheduler.stop()
})
test('a command switches to 5-second cadence for 60 seconds then 30 seconds',async()=>{
  const h=harness({commands:t=>t===0?1:0});h.scheduler.start()
  await h.c.advance(55000)
  assert.deepEqual(h.calls.slice(0,3),[0,5000,10000])
  await h.c.advance(35000)
  assert.ok(h.calls.includes(60000))
  assert.ok(h.calls.includes(90000))
  h.scheduler.stop()
})
test('offline startup makes no requests and reconnect polls immediately',async()=>{
  const h=harness({online:false});h.scheduler.start();await h.c.advance(120000)
  assert.equal(h.calls.length,0);h.setOnline(true);await h.c.advance(0)
  assert.deepEqual(h.calls,[120000]);h.scheduler.stop()
})
test('disconnect pauses and reconnect restarts without duplicate timers',async()=>{
  const h=harness();h.scheduler.start();await h.c.advance(0)
  h.setOnline(false);await h.c.advance(60000)
  assert.equal(h.calls.length,1);assert.equal(h.c.count(),0)
  h.setOnline(true);h.setOnline(true);await h.c.advance(0)
  assert.equal(h.calls.length,2);assert.equal(h.c.count(),1);h.scheduler.stop()
})
test('stop prevents further polls including scheduled after restart',async()=>{
  const h=harness();h.scheduler.start();await h.c.advance(0)
  h.scheduler.stop();await h.c.advance(120000)
  assert.equal(h.calls.length,1);assert.equal(h.c.count(),0)
  h.scheduler.start();await h.c.advance(0)
  assert.equal(h.calls.length,2);h.scheduler.stop()
})
test('failed requests back off to 30 seconds rather than hammering backend',async()=>{
  const c=clock(),calls=[]
  const p=createAdaptiveCommandPoller({poll:async()=>{calls.push(c.now());throw Error('offline gateway')},online:()=>true,schedule:c.schedule,cancel:c.cancel,now:c.now})
  p.start();await c.advance(60000)
  assert.deepEqual(calls,[0,30000,60000]);p.stop()
})
test('slow poll cannot overlap with another poll',async()=>{
  const c=clock();let resolve,started=0
  const p=createAdaptiveCommandPoller({poll:()=>{started++;return new Promise(r=>{resolve=r})},online:()=>true,schedule:c.schedule,cancel:c.cancel,now:c.now})
  p.start();await c.advance(0);await c.advance(60000)
  assert.equal(started,1)
  resolve({commandsFound:0});for(let i=0;i<8;i++)await Promise.resolve()
  await c.advance(30000);assert.equal(started,2);p.stop()
})
test('reconnect during slow in-flight poll schedules one immediate follow-up',async()=>{
  const c=clock();let resolve,started=0,connected=true
  const p=createAdaptiveCommandPoller({poll:()=>{started++;return started===1?new Promise(r=>{resolve=r}):Promise.resolve({commandsFound:0})},online:()=>connected,schedule:c.schedule,cancel:c.cancel,now:c.now})
  p.start();await c.advance(0);connected=false;p.networkChanged();connected=true;p.networkChanged()
  await c.advance(0);assert.equal(started,1)
  resolve({commandsFound:0});for(let i=0;i<8;i++)await Promise.resolve()
  await c.advance(0);assert.equal(started,2);p.stop()
})
