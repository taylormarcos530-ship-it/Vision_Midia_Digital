import test from 'node:test'
import assert from 'node:assert/strict'
import {createAdaptiveCommandPoller} from './fixtures/adaptive-command-poller-proposal.mjs'
import {createQuarantinedCommandPoll} from './fixtures/quarantined-command-poll-proposal.mjs'
function clock(){
 let time=0,id=0;const tasks=new Map()
 return {now:()=>time,count:()=>tasks.size,
 schedule:(fn,ms)=>{const key=++id;tasks.set(key,{at:time+ms,fn});return key},
 cancel:key=>tasks.delete(key),
 async advance(ms){
  const end=time+ms
  for(let i=0;i<10000;i++){
   const next=[...tasks.entries()].sort((a,b)=>a[1].at-b[1].at)[0]
   if(!next||next[1].at>end)break
   time=next[1].at;tasks.delete(next[0]);next[1].fn()
   for(let j=0;j<12;j++)await Promise.resolve()
  }
  time=end
 }}
}
test('uncooperative never-settling command query remains quarantined, no overlap',async()=>{
 const c=clock();let calls=0,alerts=0
 const gate=createQuarantinedCommandPoll({
  request:()=>{calls++;return new Promise(()=>{})},
  schedule:c.schedule,cancel:c.cancel,onQuarantine:()=>alerts++})
 const scheduler=createAdaptiveCommandPoller({poll:gate.poll,online:()=>true,
  schedule:c.schedule,cancel:c.cancel,now:c.now,idleMs:15000,errorMs:30000})
 scheduler.start();await c.advance(0);await c.advance(8000)
 assert.deepEqual(gate.state,{inFlight:true,quarantined:true})
 await c.advance(86400000)
 assert.equal(calls,1);assert.equal(alerts,1)
 assert.equal(c.count(),0)
 scheduler.stop();gate.abort()
})
test('late settlement releases quarantine; next poll only after 30s backoff',async()=>{
 const c=clock();let calls=0,resolve
 const gate=createQuarantinedCommandPoll({
  request:()=>{calls++;return calls===1?new Promise(r=>{resolve=r}):Promise.resolve({commandsFound:0})},
  schedule:c.schedule,cancel:c.cancel})
 const scheduler=createAdaptiveCommandPoller({poll:gate.poll,online:()=>true,
  schedule:c.schedule,cancel:c.cancel,now:c.now,idleMs:15000,errorMs:30000})
 scheduler.start();await c.advance(8000)
 assert.equal(gate.state.quarantined,true)
 resolve({commandsFound:1})
 for(let i=0;i<15;i++)await Promise.resolve()
 assert.equal(gate.state.quarantined,false)
 await c.advance(29999);assert.equal(calls,1)
 await c.advance(1);assert.equal(calls,2)
 scheduler.stop()
})
test('normal 15s cadence unaffected by quarantine gate',async()=>{
 const c=clock(),calls=[]
 const gate=createQuarantinedCommandPoll({
  request:async()=>{calls.push(c.now());return {commandsFound:0}},
  schedule:c.schedule,cancel:c.cancel})
 const scheduler=createAdaptiveCommandPoller({poll:gate.poll,online:()=>true,
  schedule:c.schedule,cancel:c.cancel,now:c.now,idleMs:15000})
 scheduler.start();await c.advance(45000)
 assert.deepEqual(calls,[0,15000,30000,45000])
 assert.equal(gate.state.quarantined,false);scheduler.stop()
})
test('aborting a query is not mistaken for confirmed termination',async()=>{
 const c=clock();let resolve
 const gate=createQuarantinedCommandPoll({
  request:()=>new Promise(r=>{resolve=r}),
  schedule:c.schedule,cancel:c.cancel})
 const pending=gate.poll();gate.abort()
 assert.equal(gate.state.inFlight,true)
 await c.advance(8000);assert.equal(gate.state.quarantined,true)
 resolve({commandsFound:0})
 await assert.rejects(pending,/timed out/)
 assert.deepEqual(gate.state,{inFlight:false,quarantined:false})
})
