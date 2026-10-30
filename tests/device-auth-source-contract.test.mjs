import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const paths = [
  'supabase/functions/device-gateway/index.ts',
  'supabase/functions/device-monitoring/index.ts',
]

for (const path of paths) {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
  const start = source.indexOf('async function authenticateDevice(')
  const end = source.indexOf('Deno.serve(', start)
  assert.ok(start >= 0 && end > start, path + ': auth function found')
  const auth = source.slice(start, end)
  test(path + ': reads last_used_at with revocation', () => {
    assert.match(auth, /select\('device_id,revoked_at,last_used_at'\)/)
  })
  test(path + ': checks revocation and TV block before writing', () => {
    const write = auth.indexOf('.update({ last_used_at:')
    assert.ok(write > auth.indexOf('credential.revoked_at'))
    assert.ok(write > auth.indexOf("device.access_status === 'blocked'"))
  })
  test(path + ': hourly read guard and inclusive DB guard', () => {
    assert.match(auth, /nowMs - lastUsedAt >= 60 \* 60 \* 1000/)
    assert.ok(auth.includes('last_used_at.lte.${cutoff}'))
    assert.match(auth, /\.eq\('device_id', device\.id\)/)
  })
  test(path + ': authentication still checks token on each request', () => {
    assert.match(auth, /sha256Hex\(rawToken\)/)
    assert.match(auth, /\.eq\('token_hash', tokenHash\)/)
  })
}
