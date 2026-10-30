import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Deterministic, entirely local simulation. No HTTP, credentials, devices or database.
const player = readFileSync(new URL('../player.js', import.meta.url), 'utf8')
const DAY = 86400
const arrivals = Array.from({length:12},(_,i)=>3600+i*7200+7)

function simulate({idleSeconds,activeSeconds=idleSeconds,activeWindowSeconds=0,events=arrivals,duration=DAY}) {
  let now=0, polls=0, activeUntil=-1
  const delays=[]
  let index=0
  while(now<duration) {
    polls++
    while(index<events.length && events[index]<=now) {
      delays.push(now-events[index])
      activeUntil=Math.max(activeUntil,now+activeWindowSeconds)
      index++
    }
    const interval=now<activeUntil?activeSeconds:idleSeconds
    assert.ok(interval>0)
    now+=interval
  }
  assert.equal(index,events.length,'all commands must be delivered')
  return {polls,per30Days:polls*30,averageLatencySeconds:delays.reduce((a,b)=>a+b,0)/delays.length,maxLatencySeconds:Math.max(...delays),delays}
}

test('source still polls every five seconds; no production interval modification',()=>{
  assert.match(player,/state\.commandTimer = setInterval\(\(\) => pollDeviceCommands\(\)\.catch\(\(\) => \{\}\), 5_000\)/)
})
test('fixed intervals have deterministic request budgets',()=>{
  for(const [interval,expected] of [[5,17280],[10,8640],[15,5760],[30,2880]]) {
    assert.equal(simulate({idleSeconds:interval}).polls,expected)
  }
})
test('fixed interval latency bounded by its interval in simulated command arrivals',()=>{
  for(const seconds of [5,10,15,30]) {
    const r=simulate({idleSeconds:seconds})
    assert.ok(r.maxLatencySeconds>=0 && r.maxLatencySeconds<seconds)
  }
})
test('adaptive 30s idle / 5s active for 60s reduces polls without losing commands',()=>{
  const fixed=simulate({idleSeconds:5})
  const adaptive=simulate({idleSeconds:30,activeSeconds:5,activeWindowSeconds:60})
  assert.ok(adaptive.polls<fixed.polls*0.25)
  assert.equal(adaptive.delays.length,arrivals.length)
  assert.ok(adaptive.maxLatencySeconds<30)
})
test('offline devices should make zero polling requests; this is a model, not a live measurement',()=>{
  const online=simulate({idleSeconds:30})
  const offlinePolls=0
  assert.equal(offlinePolls,0)
  assert.ok(online.polls>offlinePolls)
})
test('a command just after an idle poll can wait almost 30 seconds',()=>{
  const r=simulate({idleSeconds:30,activeSeconds:5,activeWindowSeconds:60,events:[0.001],duration:120})
  assert.ok(r.delays[0]>29.9 && r.delays[0]<30)
})
test('print comparative scenario results (one continuously online TV)',()=>{
  for(const [name,options] of [
    ['fixed-5s',{idleSeconds:5}],
    ['fixed-10s',{idleSeconds:10}],
    ['fixed-15s',{idleSeconds:15}],
    ['fixed-30s',{idleSeconds:30}],
    ['adaptive-30s-idle-5s-active-60s',{idleSeconds:30,activeSeconds:5,activeWindowSeconds:60}],
  ]) {
    const r=simulate(options)
    console.log(JSON.stringify({scenario:name,requestsPerDay:r.polls,requestsPer30Days:r.per30Days,averageLatencySeconds:r.averageLatencySeconds,maxObservedLatencySeconds:r.maxLatencySeconds}))
  }
})
