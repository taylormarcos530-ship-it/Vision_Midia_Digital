const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const src = fs.readFileSync(path.join(__dirname, '../supabase/functions/device-gateway/index.ts'),'utf8')
const player = fs.readFileSync(path.join(__dirname, '../player.js'),'utf8')
const start = src.indexOf("    if (action === 'playback' || action === 'playback_batch') {")
const end = src.indexOf("    return json({ error: 'unknown_action' }, 400)",start)
assert.ok(start>=0 && end>start,'gateway playback handler must exist')
const playbackHandler = new AsyncFunction('action','body','device','admin','json','safeNumber',src.slice(start,end))
const device = {id:'10000000-0000-4000-8000-000000000001', company_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'TV QA'}

function makeStub(error=null) {
  const calls = []
  const admin = {
    from(table) {
      const obj = {
        select() { return {eq() {return {in() { return Promise.resolve({data:[],error:null}) }}}} },
        upsert(rows,options) {
          calls.push({table,rows,options})
          return Promise.resolve({data:null,error})
        },
      }
      return obj
    },
  }
  return {admin,calls}
}
function input(id,startedAt='2026-10-24T12:00:00.000Z') {
  return {client_event_id:id, started_at:startedAt, completed:true, duration_seconds:15}
}
async function callGateway(events,stub,action='playback_batch') {
  return playbackHandler(action,{events},device,stub.admin,(data,status=200)=>({data,status}), (n,min,max) => {
    const v=Number(n); return Number.isFinite(v)?Math.max(min,Math.min(max,v)):null
  })
}
test('valid batch acknowledges all exact IDs and targets the proper unique key',async()=>{
  const s=makeStub(),out=await callGateway([input('one'),input('two')],s)
  assert.deepEqual(out,{status:200,data:{ok:true,accepted:2}})
  assert.equal(s.calls.length,1)
  assert.equal(s.calls[0].table,'playback_logs')
  assert.deepEqual(s.calls[0].options,{onConflict:'device_id,client_event_id',ignoreDuplicates:true})
  assert.deepEqual(s.calls[0].rows.map(r=>r.client_event_id),['one','two'])
  assert.ok(s.calls[0].rows.every(r=>r.company_id===device.company_id&&r.device_id===device.id))
})
test('mixed valid and invalid IDs are atomically rejected: zero database upserts',async()=>{
  const s=makeStub(),out=await callGateway([input('good'),{client_event_id:'',started_at:'2026-10-24T12:00:00Z'}],s)
  assert.equal(out.status,400);assert.equal(out.data.error,'invalid_playback_event')
  assert.equal(s.calls.length,0)
})
test('a 121-char ID must not be silently truncated into a duplicate',async()=>{
  const s=makeStub(),out=await callGateway([input('x'.repeat(121))],s)
  assert.equal(out.status,400);assert.equal(s.calls.length,0)
})
test('invalid date must reject whole batch with no storage',async()=>{
  const s=makeStub(),out=await callGateway([input('valid'),input('invalid','not-a-date')],s)
  assert.equal(out.status,400);assert.equal(s.calls.length,0)
})
test('repeat acknowledgment is OK if DB upsert skipped duplicates',async()=>{
  const s=makeStub(),out=await callGateway([input('already-archived')],s)
  assert.equal(out.status,200);assert.equal(out.data.accepted,1)
})
test('database error fails the batch, letting player retain queued IDs',async()=>{
  const s=makeStub({message:'synthetic PostgreSQL write failed'})
  const out=await callGateway([input('event-1')],s)
  assert.equal(out.status,400);assert.equal(out.data.error,'playback_log_failed')
})
test('batch boundaries: 100 accepted, 101 rejected',async()=>{
  const s=makeStub(),out=await callGateway(Array.from({length:100},(_,i)=>input('evt-'+i)),s)
  assert.equal(out.status,200);assert.equal(out.data.accepted,100)
  const s2=makeStub(),out2=await callGateway(Array.from({length:101},(_,i)=>input('evt-'+i)),s2)
  assert.equal(out2.status,400);assert.equal(s2.calls.length,0)
})
test('player acknowledges queue only after gateway resolves',()=>{
  const block=player.slice(player.indexOf('  async function flushPlaybackQueue()'),player.indexOf('\n  function deviceEventQueue()'))
  assert.ok(block.includes("await gateway({ action: 'playback_batch', events: batch })"))
  assert.ok(block.indexOf("await gateway({ action: 'playback_batch', events: batch })")<block.indexOf("const confirmed = new Set("))
  assert.ok(block.includes("const latest = playbackQueue()"))
  assert.ok(block.includes("const remainder = latest.filter("))
  assert.ok(block.includes("finally { playbackFlushInFlight = null; }"))
})
