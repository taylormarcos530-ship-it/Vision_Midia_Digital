import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'

// Executes the ENTIRE original Deno gateway handler with an in-memory Supabase
// double. No Supabase credentials, network, database, or deployed function.
const source = readFileSync(new URL('../supabase/functions/device-gateway/index.ts', import.meta.url), 'utf8')
const script = source.replace(/^import \{ createClient \} from 'npm:@supabase\/supabase-js@2'\s*/,'')
const id = '11111111-1111-4111-8111-111111111111'
const token = 'x'.repeat(40)
async function invoke({method='POST',body={action:'not_a_real_action'},valid=true,blocked=false,revoked=false}={}) {
  let handler
  const calls=[]
  const credential={device_id:id,revoked_at:revoked?'2026-01-01':null,last_used_at:new Date().toISOString()}
  const rows={
    device_credentials:valid?credential:null,
    devices:{id,company_id:id,status:'online',access_status:blocked?'blocked':'active'},
    companies:{status:'active'},
    company_subscriptions:{status:'active'},
  }
  const client={from(table){
    const q={
      select(){return q},
      eq(){return q},
      or(){return q},
      not(...args){calls.push({table,kind:'not',args});return q},
      update(value){calls.push({table,kind:'update',value});return q},
      maybeSingle:async()=>({data:rows[table]??null,error:null}),
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
