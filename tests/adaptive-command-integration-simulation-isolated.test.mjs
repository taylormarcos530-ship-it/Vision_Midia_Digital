import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createSimulatedCommandIntegration} from './fixtures/simulated-command-integration-proposal.mjs'
function clock(){
 let t=0,id=0;const tasks=new Map()
 return {now:()=>t,count:()=>tasks.size,
  schedule:(fn,ms)=>{const k=++id;tasks.set(k,{at:t+ms,fn});return k},
  cancel:k=>tasks.delete(k),
  async advance(ms){
   const end=t+ms
   for(let i=0;i<10000;i++){
    const next=[...tasks.entries()].sort((a,b)=>a[1].at-b[1].at)[0]
    if(!next||next[1].at>end)break
    t=next[1].at;tasks.delete(next[0]);next[1].fn()
    for(let j=0;j<20;j++)await Promise.resolve()
   }
   t=end
  }
 }
}
function harness(poll){
 const c=clock(),h=createSimulatedCommandIntegration({poll,schedule:c.schedule,cancel:c.cancel})
 h.setClock(c.now)
 return {c,h}
}
test('repeated acknowledged screenshot command is captured once',async()=>{
 let captures=0,acks=0
 const cmd={id:'shot1',type:'screenshot',capture:async()=>{captures++;return true},ack:async()=>{acks++;return true}}
 const {c,h}=harness(async()=>[cmd])
 h.start('token-A');await c.advance(70000)
 assert.equal(captures,1);assert.equal(acks,1)
 assert.deepEqual(h.state.ack,['shot1']);h.stop()
})
test('lost screenshot confirmation remains unacknowledged for server reconciliation',async()=>{
 let captures=0,acks=0
 const cmd={id:'shot2',type:'screenshot',capture:async()=>{captures++;return true},ack:async()=>{acks++;throw Error('response lost')}}
 const {c,h}=harness(async()=>[cmd])
 h.start('token-A');await c.advance(5000)
 assert.equal(captures,2);assert.equal(acks,2)
 assert.deepEqual(h.state.ack,[]);h.stop()
})
test('token change while poll is pending rejects stale response and polls new token',async()=>{
 let finish,oldCaptures=0,newCaptures=0
 const old={id:'old',type:'screenshot',capture:async()=>{oldCaptures++;return true},ack:async()=>true}
 const fresh={id:'new',type:'screenshot',capture:async()=>{newCaptures++;return true},ack:async()=>true}
 const {c,h}=harness(token=>token==='token-A'?new Promise(resolve=>{finish=()=>resolve([old])}):Promise.resolve([fresh]))
 h.start('token-A');await c.advance(0)
 h.start('token-B');await c.advance(0)
 finish();for(let i=0;i<20;i++)await Promise.resolve()
 await c.advance(0)
 assert.equal(oldCaptures,0);assert.equal(newCaptures,1)
 h.stop()
})
test('restart removes prior timers and resumes one polling schedule',async()=>{
 const calls=[]
 const {c,h}=harness(async token=>{calls.push({token,t:c.now()});return []})
 h.start('token-A');await c.advance(0)
 h.stop();assert.equal(c.count(),0)
 await c.advance(60000);assert.equal(calls.length,1)
 h.start('token-A');await c.advance(0)
 assert.equal(calls.length,2);assert.equal(c.count(),1);h.stop()
})
test('rollback to fixed 5s polling preserves single timer',async()=>{
 const calls=[]
 const {c,h}=harness(async()=>{calls.push(c.now());return []})
 h.start('token-A');await c.advance(0)
 await c.advance(15000)
 assert.deepEqual(calls,[0,15000])
 h.rollback();await c.advance(15000)
 assert.deepEqual(calls,[0,15000,20000,25000,30000])
 assert.equal(h.state.mode,'fixed');assert.equal(c.count(),1)
 h.stop();assert.equal(c.count(),0)
})
test('simulation is not imported into official player.js',()=>{
 const player=readFileSync(new URL('../player.js',import.meta.url),'utf8')
 assert.doesNotMatch(player,/simulated-command-integration-proposal/)
 assert.match(player,/state\.commandTimer = setInterval\(\(\) => pollDeviceCommands\(\)\.catch\(\(\) => \{\}\), 5_000\)/)
})
