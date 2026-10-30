// Node built-in test runner: node --test tests/playback-batch-dedup.test.mjs
// Regression contract for the gateway's in-batch client_event_id filtering.
// This is a behavioral model, not an integration test against Supabase.
import test from 'node:test'
import assert from 'node:assert/strict'

function filterPlaybackEvents(events) {
  const parsedEvents = []
  const seenClientEventIds = new Set()
  for (const event of events) {
    const clientEventId = String(event?.client_event_id || '').slice(0, 120)
    const startedAt = new Date(event?.started_at || Date.now())
    const endedAt = event?.ended_at ? new Date(event.ended_at) : null
    if (!clientEventId || Number.isNaN(startedAt.getTime()) || (endedAt && Number.isNaN(endedAt.getTime()))) continue
    if (seenClientEventIds.has(clientEventId)) continue
    seenClientEventIds.add(clientEventId)
    parsedEvents.push({ client_event_id: clientEventId, started_at: startedAt.toISOString() })
  }
  return parsedEvents
}
const event = (id, started_at = '2026-10-30T10:00:00.000Z') => ({ client_event_id: id, started_at })

test('keeps first event per id in a batch', () => {
  assert.deepEqual(filterPlaybackEvents([event('a'), event('a'), event('b')]).map(e => e.client_event_id), ['a', 'b'])
})
test('does not drop distinct valid events', () => {
  const input = Array.from({ length: 100 }, (_, i) => event('event-' + i))
  assert.equal(filterPlaybackEvents(input).length, 100)
})
test('invalid first event does not block a valid retry of same id', () => {
  assert.deepEqual(filterPlaybackEvents([event('a', 'invalid'), event('a')]).map(e => e.client_event_id), ['a'])
})
test('rejects empty ids and invalid dates', () => {
  assert.equal(filterPlaybackEvents([event(''), event('x', 'invalid')]).length, 0)
})
test('deduplication scope is per request, not across batches', () => {
  assert.equal(filterPlaybackEvents([event('a')]).length, 1)
  assert.equal(filterPlaybackEvents([event('a')]).length, 1)
})

// Player contract: a successful batch response acknowledges the whole submitted batch;
// accepted is informational and is not used to slice the queue.
function simulatePlayerFlush(queue, responseOk) {
  const batch = queue.slice(0, 50)
  if (!responseOk) throw new Error('playback_log_failed')
  return queue.slice(batch.length)
}

test('successful response clears submitted batch even with duplicate IDs', () => {
  const queue = [event('a'), event('a'), event('b')]
  assert.equal(filterPlaybackEvents(queue).length, 2)
  assert.deepEqual(simulatePlayerFlush(queue, true), [])
})
test('failed response does not acknowledge queued events', () => {
  const queue = [event('a'), event('b')]
  assert.throws(() => simulatePlayerFlush(queue, false), /playback_log_failed/)
  assert.equal(queue.length, 2)
})
