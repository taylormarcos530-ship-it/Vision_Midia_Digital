// Stage A isolated static + mock-state tests. No network, database or production access.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const root = new URL('../index.ts', import.meta.url)
const backup = new URL('../index.ts.v30-stage-a.backup', import.meta.url)
const source = readFileSync(root, 'utf8')
const original = readFileSync(backup, 'utf8')
const oldBlock = `    const { error: stateError } = await admin.from('device_health_push_state')
      .upsert(next, { onConflict: 'device_id' })
    if (stateError) throw stateError`
const newBlock = `    // Stage A: avoid an unchanged-state UPSERT; keep all alert decisions above intact.
    const stateChanged = previous.connected !== connected ||
      previous.active_error_key !== activeError ||
      previous.outdated_apk_key !== outdated
    if (stateChanged) {
      const { error: stateError } = await admin.from('device_health_push_state')
        .upsert(next, { onConflict: 'device_id' })
      if (stateError) throw stateError
    }`
test('only approved scanner block differs from original', () => {
  assert.equal(original.split(oldBlock).length, 2)
  assert.equal(source, original.replace(oldBlock, newBlock))
})
test('unchanged state skips write; each field change writes exactly once', () => {
  const expr = /const stateChanged = ([\\s\\S]*?)\\n    if \\(stateChanged\\)/.exec(source)
  assert.ok(expr)
  const predicate = new Function('previous', 'connected', 'activeError', 'outdated', 'return (' + expr[1].trim() + ')')
  const base = { connected: true, active_error_key: null, outdated_apk_key: null }
  const cases = [
    [base, true, null, null, false],
    [base, false, null, null, true],
    [base, true, 'E42', null, true],
    [base, true, null, '1.5.20→1.5.24', true],
    [{...base, active_error_key:'E42'}, true, null, null, true],
    [{...base, outdated_apk_key:'1.5.20→1.5.24'}, true, null, null, true],
    [{...base, active_error_key:'E42'}, true, 'E42', null, false],
    [{...base, outdated_apk_key:'1.5.20→1.5.24'}, true, null, '1.5.20→1.5.24', false],
    [base, false, 'E42', '1.5.20→1.5.24', true],
  ]
  for (const [previous, connected, activeError, outdated, expected] of cases) {
    let mockUpserts = 0
    if (predicate(previous, connected, activeError, outdated)) mockUpserts++
    assert.equal(mockUpserts, Number(expected))
  }
})
test('first-scan quiet baseline and notification queue are unchanged', () => {
  assert.match(source, /if \\(!previous\\) \\{/)
  assert.match(source, /ignoreDuplicates: true/)
  assert.match(source, /const delivery = await flushQueue\\(admin\\)/)
  assert.match(source, /const MAX_DEVICES = 500/)
  assert.match(source, /const OFFLINE_AFTER_MS = 3 \\* 60 \\* 1000/)
})
