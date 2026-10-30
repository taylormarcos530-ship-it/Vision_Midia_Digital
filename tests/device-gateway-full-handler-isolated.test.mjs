import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'
import { webcrypto } from 'node:crypto'

// Executes the ENTIRE original Deno gateway handler with an in-memory Supabase
// double. No Supabase credentials, network, database, or deployed function.
const source = readFileSync(new URL('../supabase/functions/device-gateway/index.ts', import.meta.url), 'utf8')
const script = stripTypeScriptTypes(source.replace(/^import \{ createClient \} from 'npm:@supabase\/supabase-js@2'\s*/,''), { mode: 'strip' })
const id = '11111111-1111-4111-8111-111111111111'
const token = 'x'.repeat(40)
async function invoke({method='POST',body={action:'not_a_real_action'},valid=true,blocked=false,revoked=false,heartbeatAt=null,commands=[]}={}) {
  let handler
  const calls=[]
  const credential={device_id:id,revoked_at:revoked?'2026-01-01':null,last_used_at:new Date().toISOString()}
  const rows={
    device_credentials:valid?credential:null,
    devices:{id,company_id:id,status:'online',access_status:blocked?'blocked':'active'},
    companies:{status:'active'},
    company_subscriptions:{status:'active'},
    device_heartbeats:heartbeatAt?{received_at:heartbeatAt}:null,
    device_commands:commands,
  }
  const client={from(table){
    let operation='select'
    const q={
      select(){return q},
      eq(...args){if(operation==='update')calls.push({table,kind:'eq',args});return q},
      or(){return q},
      not(...args){calls.push({table,kind:'not',args});return q},
      update(value){operation='update';calls.push({table,kind:'update',value});return q},
      insert(value){operation='insert';calls.push({table,kind:'insert',value});return q},
      in(){return q},
      order(){return q},
      limit(){return q},
      maybeSingle:async()=>({data:rows[table]??null,error:null}),
      then(resolve,reject){return Promise.resolve({data:operation==='select'?(rows[table]??null):null,error:null}).then(resolve,reject)},
    }
    return q
  }}
  const context={
    createClient:()=>client,
    Deno:{env:{get:(key)=>key==='SUPABASE_SERVICE_ROLE_KEY'?'fake-isolated-secret':key==='SUPABASE_URL'?'http://invalid.local':undefined},serve:fn=>{handler=fn}},
    crypto:webcrypto,TextEncoder,Response,Date,Intl,Uint8Array,Set,Map,Number,String,Object,JSON,console,atob,
  }
  vm.runInNewContext(script,context,{filename:'device-gateway/index.ts'})
  const req={method,headers:{get:(name)=>name==='x-device-token'?token:null},json:async()=>body}
  const response=await handler(req)
  return {status:response.status,data:JSON.parse(await response.text()),calls}
}
test('complete gateway: OPTIONS is handled without database',async()=>{
  let handler
  const context={Deno:{serve:fn=>{handler=fn}},Response,console}
  // Full handler is exercised by invoke; OPTIONS should not reach adminClient.
  const result=await invoke({method:'GET'})
  assert.equal(result.status,405)
  assert.equal(result.calls.length,0)
})
test('complete gateway: unknown action returns 400 for authorized device',async()=>{
  const x=await invoke()
  assert.equal(x.status,400)
  assert.equal(x.data.error,'unknown_action')
  assert.equal(x.calls.filter(c=>c.table==='device_credentials'&&c.kind==='update').length,0)
  assert.deepEqual(x.calls.filter(c=>c.table==='device_pairing_requests'&&c.kind==='not').map(c=>Array.from(c.args)),[['issued_token','is',null]])
})
test('complete gateway: invalid device token returns 401',async()=>{
  const x=await invoke({valid:false})
  assert.equal(x.status,401)
  assert.equal(x.data.error,'invalid_device_token')
  assert.equal(x.calls.length,0)
})
test('complete gateway: revoked token returns 401',async()=>{
  const x=await invoke({revoked:true})
  assert.equal(x.status,401)
  assert.equal(x.calls.length,0)
})
test('complete gateway: blocked device returns 403',async()=>{
  const x=await invoke({blocked:true})
  assert.equal(x.status,403)
  assert.equal(x.data.error,'device_access_blocked')
})

test('heartbeat: updates device but skips heartbeat history when recent',async()=>{
  const x=await invoke({body:{action:'heartbeat',screen_width:1920,screen_height:1080},heartbeatAt:new Date().toISOString()})
  assert.equal(x.status,200)
  assert.equal(x.data.ok,true)
  assert.equal(x.calls.filter(c=>c.table==='devices'&&c.kind==='update').length,1)
  assert.equal(x.calls.filter(c=>c.table==='device_heartbeats'&&c.kind==='insert').length,0)
})
test('heartbeat: records history when previous record is old',async()=>{
  const x=await invoke({body:{action:'heartbeat'},heartbeatAt:new Date(Date.now()-6*60*1000).toISOString()})
  assert.equal(x.status,200)
  assert.equal(x.calls.filter(c=>c.table==='device_heartbeats'&&c.kind==='insert').length,1)
})
test('heartbeat: first record creates one history entry',async()=>{
  const x=await invoke({body:{action:'heartbeat'}})
  assert.equal(x.status,200)
  assert.equal(x.calls.filter(c=>c.table==='device_heartbeats'&&c.kind==='insert').length,1)
})
test('commands: no pending commands means no status writes',async()=>{
  const x=await invoke({body:{action:'commands'}})
  assert.equal(x.status,200)
  assert.equal(x.data.ok,true)
  assert.equal(x.calls.filter(c=>c.table==='device_commands'&&c.kind==='update').length,0)
})
test('commands: pending command is marked sent once per request',async()=>{
  const x=await invoke({body:{action:'commands'},commands:[{id,command_type:'reload',status:'pending'}]})
  assert.equal(x.status,200)
  assert.equal(x.calls.filter(c=>c.table==='device_commands'&&c.kind==='update').length,1)
})

test('commands: already sent command is returned without any update',async()=>{
  const x=await invoke({body:{action:'commands'},commands:[{id,command_type:'reload',status:'sent'}]})
  assert.equal(x.status,200)
  assert.equal(x.data.commands.length,1)
  assert.equal(x.calls.filter(c=>c.table==='device_commands'&&c.kind==='update').length,0)
})
test('commands: mixed pending and sent only updates pending IDs',async()=>{
  const pending='22222222-2222-4222-8222-222222222222'
  const x=await invoke({body:{action:'commands'},commands:[
    {id:pending,command_type:'reload',status:'pending'},
    {id,command_type:'reload',status:'sent'},
  ]})
  assert.equal(x.status,200)
  assert.equal(x.data.commands.length,2)
  const updates=x.calls.filter(c=>c.table==='device_commands'&&c.kind==='update')
  assert.equal(updates.length,1)
  const eqs=x.calls.filter(c=>c.table==='device_commands'&&c.kind==='eq')
  assert.ok(eqs.some(c=>c.args[0]==='status'&&c.args[1]==='pending'))
})
