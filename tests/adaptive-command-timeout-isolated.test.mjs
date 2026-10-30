import test from 'node:test'
import assert from 'node:assert/strict'
import {createAdaptiveCommandPoller} from './fixtures/adaptive-command-poller-proposal.mjs'
import {createAbortableCommandPoll} from './fixtures/abortable-command-poll-proposal.mjs'
function clock(){
 let t=0,n=0;const tasks=new Map()
 return {
  now:()=>t, count:()=>tasks.size,
  schedule:(fn,delay)=>{const id=++n;tasks.set(id,{at:t+delay,fn});return id},
  cancel:id=>tasks.delete(id),
  async advance(ms){
   const end=t+ms
   for(let i=0;i<10000;i++){
    const entry=[...tasks.entries()].sort((a,b)=>a[1].at-b[1].at)[0]
    if(!entry||entry[1].at>end)break
    t=entry[1].at;tasks.delete(entry[0]);entry[1].fn()
    for(let j=0;j<12;j++)await Promise.resolve()
   }
   t=end
  }
 }
}
function setup(request){
 const c=clock(),events=[]
 const adapter=createAbortableCommandPoll({request,schedule:c.schedule,cancel:c.cancel,timeoutMs:8000,onTimeout:()=>events.push(c.now())})
 const scheduler=createAdaptiveCommandPoller({poll:adapter.poll,online:()=>true,schedule:c.schedule,cancel:c.cancel,now:c.now,idleMs:15000,errorMs:30000})
 return {c,events,adapter,scheduler}
}
test('15s idle cadence stays intact when transport succeeds',async()=>{
 const calls=[]
 const h=setup(async()=>{calls.push(h.c.now());return {commandsFound:0}})
 h.scheduler.start();await h.c.advance(45000)
 assert.deepEqual(calls,[0,15000,30000,45000])
 assert.equal(h.events.length,0);h.scheduler.stop()
})
test('abort-aware timeout at 8s: no overlap and 30s backoff after settlement',async()=>{
 let calls=0,active=0,max=0
 const h=setup(({signal})=>{
  calls++;active++;max=Math.max(max,active)
  return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{active--;reject(Error('aborted'))},{once:true}))
 })
 h.scheduler.start();await h.c.advance(8000)
 assert.deepEqual(h.events,[8000]);assert.equal(calls,1)
 assert.equal(max,1);assert.equal(active,0)
 await h.c.advance(29999);assert.equal(calls,1)
 await h.c.advance(1);assert.equal(calls,2)
 assert.equal(max,1);h.scheduler.stop();h.adapter.abort()
})
test('uncooperative transport never creates concurrent screenshot polls',async()=>{
 let calls=0,finish
 const h=setup(()=>{calls++;return new Promise(resolve=>{finish=resolve})})
 h.scheduler.start();await h.c.advance(8000)
 assert.equal(h.adapter.state.inFlight,true)
 assert.equal(h.adapter.state.timeoutRequested,true)
 await h.c.advance(120000)
 assert.equal(calls,1)
 finish({commandsFound:1})
 for(let i=0;i<12;i++)await Promise.resolve()
 assert.equal(h.adapter.state.inFlight,false)
 await h.c.advance(30000)
 assert.equal(calls,2)
 h.scheduler.stop();h.adapter.abort()
})
test('successful screenshot completion is not mistaken for timeout',async()=>{
 const h=setup(async()=>({commandsFound:1}))
 h.scheduler.start();await h.c.advance(0)
 assert.equal(h.adapter.state.inFlight,false)
 assert.equal(h.events.length,0)
 await h.c.advance(5000)
 assert.equal(h.events.length,0)
 h.scheduler.stop()
})
test('stop and restart leave no scheduled command polls or timeout timers',async()=>{
 const h=setup(async()=>({commandsFound:0}))
 h.scheduler.start();await h.c.advance(0)
 h.scheduler.stop();assert.equal(h.c.count(),0)
 await h.c.advance(60000);assert.equal(h.c.count(),0)
 h.scheduler.start();await h.c.advance(0)
 assert.equal(h.c.count(),1);h.scheduler.stop()
})
