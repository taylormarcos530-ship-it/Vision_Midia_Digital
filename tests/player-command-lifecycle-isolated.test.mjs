import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Execute the actual pollDeviceCommands() body from player.js, not a rewritten model.
// All gateways, frames and network state are in-memory. No Supabase, TV or APK access.
const source = readFileSync(new URL('../player.js', import.meta.url), 'utf8')
const start = source.indexOf('  async function pollDeviceCommands() {')
const end = source.indexOf('  function shuffled(', start)
assert.ok(start >= 0 && end > start, 'player command handler source not found')
const handler = source.slice(start, end)
const id = 'isolated-screenshot-1'

function harness({online=true, commands=[{id,command_type:'screenshot',status:'sent'}],loseResult=false,failCapture=false}={}) {
  const state = {deviceToken:'isolated-only',processingCommands:new Set()}
  const navigator = {onLine:online}
  const calls = []
  let resultLost = loseResult
  const gateway = async payload => {
    calls.push(payload.action)
    if(payload.action==='commands') return {commands}
    if(payload.action==='screenshot_result' && resultLost) {
      resultLost=false
      throw Error('simulated lost response after server processed result')
    }
    return {ok:true}
  }
  const captureCurrentFrame = async () => {
    calls.push('capture')
    if(failCapture) throw Error('simulated capture failure')
    return {image_base64:'isolated',width:1,height:1}
  }
  const context = {state,navigator,gateway,captureCurrentFrame,String,Error}
  vm.runInNewContext(handler+'\nthis.poll=pollDeviceCommands',context)
  return {state,navigator,calls,poll:context.poll}
}

test('offline: does not poll or capture; reconnection resumes command',async()=>{
  const h=harness({online:false})
  await h.poll()
  assert.deepEqual(h.calls,[])
  h.navigator.onLine=true
  await h.poll()
  assert.deepEqual(h.calls,['commands','capture','screenshot_result'])
})
test('screenshot success sends result and releases in-memory lock',async()=>{
  const h=harness()
  await h.poll()
  assert.deepEqual(h.calls,['commands','capture','screenshot_result'])
  assert.equal(h.state.processingCommands.size,0)
})
test('lost result response causes error report and later retry: current behavior documented',async()=>{
  const h=harness({loseResult:true})
  await h.poll()
  assert.deepEqual(h.calls,['commands','capture','screenshot_result','screenshot_error'])
  await h.poll()
  assert.deepEqual(h.calls.slice(4),['commands','capture','screenshot_result'])
})
test('restart resets processing set: sent command can be processed again',async()=>{
  const first=harness()
  await first.poll()
  const restarted=harness()
  await restarted.poll()
  assert.deepEqual(restarted.calls,['commands','capture','screenshot_result'])
})
test('capture failure reports screenshot_error and releases processing lock',async()=>{
  const h=harness({failCapture:true})
  await h.poll()
  assert.deepEqual(h.calls,['commands','capture','screenshot_error'])
  assert.equal(h.state.processingCommands.size,0)
})
test('unsupported command type is not executed by web screenshot poller',async()=>{
  const h=harness({commands:[{id,command_type:'restart',status:'sent'}]})
  await h.poll()
  assert.deepEqual(h.calls,['commands'])
})
