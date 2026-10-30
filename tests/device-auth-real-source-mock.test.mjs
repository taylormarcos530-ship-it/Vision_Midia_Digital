import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Executa a função authenticateDevice ORIGINAL extraída do código Deno,
// com Supabase simulado e sem rede. Não testa a implantação real.
const id = '11111111-1111-4111-8111-111111111111'
for (const path of ['supabase/functions/device-gateway/index.ts','supabase/functions/device-monitoring/index.ts']) {
  const source = readFileSync(new URL('../'+path, import.meta.url),'utf8')
  const start = source.indexOf('async function authenticateDevice(')
  const end = source.indexOf('\nDeno.serve(',start)
  assert.ok(start>=0 && end>start,path)
  const fn = vm.runInNewContext(source.slice(start,end)+'\nauthenticateDevice',{sha256Hex:async()=> 'hashed',Date})
  function setup({revoked=false,blocked=false,companyStatus='active',subscriptionStatus='active',lastUsedAt=null}={}) {
    const calls=[]
    const credential={device_id:id,revoked_at:revoked?'2026-01-01':null,last_used_at:lastUsedAt}
    const device={id,company_id:id,status:'online',access_status:blocked?'blocked':'active'}
    const values={device_credentials:credential,devices:device,companies:{status:companyStatus},company_subscriptions:{status:subscriptionStatus}}
    const admin={from(table){const q={select(){return q},eq(){return q},or(){return q},not(...args){calls.push({table,filter:args});return q},update(value){calls.push({table,value});return q},maybeSingle:async()=>({data:values[table],error:null})};return q}}
    const req={headers:{get:()=> 'x'.repeat(40)}}
    return {admin,req,calls}
  }
  test(path+': valid token authenticates and avoids writes for recent use',async()=>{
    const x=setup({lastUsedAt:new Date().toISOString()})
    const result=await fn(x.admin,x.req)
    assert.equal(result.id,id)
    assert.equal(x.calls.filter(c=>c.table==='device_credentials').length,0)
  })
  test(path+': revoked credential rejected without writes',async()=>{
    const x=setup({revoked:true})
    assert.equal(await fn(x.admin,x.req),null)
    assert.equal(x.calls.length,0)
  })
  test(path+': blocked device does not write usage',async()=>{
    const x=setup({blocked:true})
    const result=await fn(x.admin,x.req)
    assert.equal(result.access_block,'blocked')
    assert.equal(x.calls.length,0)
  })
  test(path+': old credential schedules one guarded update',async()=>{
    const x=setup({lastUsedAt:'2025-01-01T00:00:00.000Z'})
    await fn(x.admin,x.req)
    assert.equal(x.calls.filter(c=>c.table==='device_credentials').length,1)
  })
}

test('gateway: pairing cleanup filters out already-null tokens',async()=>{
  const source=readFileSync(new URL('../supabase/functions/device-gateway/index.ts',import.meta.url),'utf8')
  assert.match(source,/\.from\('device_pairing_requests'\)[\s\S]*?\.update\(\{ issued_token: null \}\)[\s\S]*?\.eq\('status', 'issued'\)[\s\S]*?\.not\('issued_token', 'is', null\)/)
})
