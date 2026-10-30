import test from 'node:test'
import assert from 'node:assert/strict'

// Harness isolado: reproduz o caminho playback_batch do gateway com mock das consultas/upsert.
// Não abre rede, não autentica TV real, não modifica Supabase.
const uuid = '11111111-1111-4111-8111-111111111111'
function gatewayBatch(events, db) {
  if (!Array.isArray(events) || events.length < 1 || events.length > 100)
    return { status: 400, error: 'invalid_playback_batch' }
  const seen = new Set()
  const rows = []
  for (const event of events) {
    const id = String(event?.client_event_id || '').slice(0, 120)
    const start = new Date(event?.started_at || Date.now())
    const end = event?.ended_at ? new Date(event.ended_at) : null
    if (!id || Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime())) || seen.has(id)) continue
    seen.add(id)
    rows.push({ device_id: uuid, client_event_id: id, started_at: start.toISOString() })
  }
  if (!rows.length) return { status: 400, error: 'invalid_playback_event' }
  const error = db.upsert(rows, { onConflict: 'device_id,client_event_id', ignoreDuplicates: true })
  if (error) return { status: 400, error: 'playback_log_failed' }
  return { status: 200, accepted: rows.length }
}
function mockDB() {
  const keys = new Set()
  const calls = []
  let fail = false
  return {
    keys, calls,
    setFail(value) { fail = value },
    upsert(rows, options) {
      calls.push({ rows, options })
      if (fail) return new Error('mock_failure')
      for (const row of rows) keys.add(row.device_id + ':' + row.client_event_id)
      return null
    },
  }
}
const event = (id, date = '2026-10-30T10:00:00Z') => ({ client_event_id: id, started_at: date })

test('batch duplicate yields one row to mock database', () => {
  const db = mockDB()
  assert.equal(gatewayBatch([event('a'), event('a'), event('b')], db).accepted, 2)
  assert.equal(db.calls.length, 1)
  assert.deepEqual(db.calls[0].rows.map(x => x.client_event_id), ['a','b'])
  assert.deepEqual(db.calls[0].options, { onConflict: 'device_id,client_event_id', ignoreDuplicates: true })
})
test('repeated batch is idempotent at mock unique key', () => {
  const db = mockDB()
  gatewayBatch([event('a')], db)
  gatewayBatch([event('a')], db)
  assert.equal(db.keys.size, 1)
  assert.equal(db.calls.length, 2)
})
test('invalid first occurrence allows valid retry', () => {
  const db = mockDB()
  assert.equal(gatewayBatch([event('a','invalid'),event('a')], db).accepted, 1)
  assert.equal(db.keys.size, 1)
})
test('invalid batch does not call database', () => {
  const db = mockDB()
  assert.equal(gatewayBatch([],db).status, 400)
  assert.equal(gatewayBatch([event('','invalid')],db).status, 400)
  assert.equal(db.calls.length, 0)
})
test('database failure returns error and does not persist', () => {
  const db = mockDB()
  db.setFail(true)
  assert.equal(gatewayBatch([event('a')],db).error, 'playback_log_failed')
  assert.equal(db.keys.size, 0)
  db.setFail(false)
  assert.equal(gatewayBatch([event('a')],db).status, 200)
  assert.equal(db.keys.size, 1)
})
test('batch maximum is 100', () => {
  const db = mockDB()
  assert.equal(gatewayBatch(Array.from({length:101},(_,i)=>event(String(i))),db).status, 400)
  assert.equal(db.calls.length, 0)
})
