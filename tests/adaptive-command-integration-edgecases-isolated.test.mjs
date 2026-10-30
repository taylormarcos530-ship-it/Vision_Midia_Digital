import test from 'node:test'
import assert from 'node:assert/strict'
import {createSimulatedCommandIntegration} from './fixtures/simulated-command-integration-proposal.mjs'
function clock(){let t=0,n=0;const tasks=new Map();return {
 now:()=>t,count:()=>tasks.size,
 schedule:(fn,ms)=>{const id=++n;tasks.set(id,{at:t+ms,fn});return id},
 cancel:id=>tasks.delete(id),
 async advance(ms){const end=t+ms;for(let i=0;i<10000;i++){const next=[...tasks.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;t=next[1].at;tasks.delete(next[0]);next[1].fn();for(let j=0;j<30;j++)await Promise.resolve()}t=end}
}}
function setup(poll){const c=clock(),h=createSimulatedCommandIntegration({poll,schedule:c.schedule,cancel:c.cancel});h.setClock(c.now);return {c,h}}
test('rollback while query pending never starts overlapping command request',async()=>{
 let finish,active=0,max=0,calls=0
 const {c,h}=setup(()=>{calls++;active++;max=Math.max(max,active);return calls===1?new Promise(resolve=>{finish=()=>{active--;resolve([])}}):Promise.resolve().then(()=>{active--;return []})})
 h.start('a');await c.advance(0);h.rollback();await c.advance(30000)
 assert.equal(calls,1);assert.equal(max,1)
 finish();for(let i=0;i<30;i++)await Promise.resolve()
 await c.advance(0);assert.equal(max,1)
 h.stop()
})
test('token change after capture but before ACK suppresses stale acknowledgment',async()=>{
 let finishCapture,acks=0
 const cmd={id:'old-shot',type:'screenshot',capture:()=>new Promise(resolve=>{finishCapture=()=>resolve(true)}),ack:async()=>{acks++;return true}}
 const {c,h}=setup(t=>Promise.resolve(t==='a'?[cmd]:[]))
 h.start('a');await c.advance(0);assert.equal(typeof finishCapture,'function')
 h.start('b');finishCapture();for(let i=0;i<30;i++)await Promise.resolve()
 await c.advance(0);assert.equal(acks,0);assert.deepEqual(h.state.ack,[])
 h.stop()
})
test('lost screenshot ACK response is not falsely recorded as success',async()=>{
 let attempts=0
 const cmd={id:'lost',type:'screenshot',capture:async()=>true,ack:async()=>{attempts++;throw Error('lost response')}}
 const {c,h}=setup(async()=>[cmd])
 h.start('a');await c.advance(5000)
 assert.equal(attempts,2);assert.deepEqual(h.state.ack,[])
 h.stop()
})
test('simulated idle command request counts: 15s versus 5s',async()=>{
 const counts={}
 for(const mode of ['adaptive','fixed']){
  let calls=0
  const {c,h}=setup(async()=>{calls++;return []})
  h.start('a');if(mode==='fixed')h.rollback()
  await c.advance(60000);counts[mode]=calls;h.stop()
 }
 assert.equal(counts.adaptive,5)
 assert.equal(counts.fixed,12)
 assert.ok(counts.adaptive<counts.fixed)
})
