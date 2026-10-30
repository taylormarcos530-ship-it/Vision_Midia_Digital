import test from 'node:test'
import assert from 'node:assert/strict'
const HOUR = 3600000
const NOW = Date.parse('2026-10-30T12:00:00Z')
const shouldWrite = (last, now) => { const t = last ? Date.parse(last) : NaN; return !Number.isFinite(t) || now - t >= HOUR }
const dbAllows = (last, now) => last == null || Date.parse(last) <= now - HOUR
function simulate(credential, db, now = NOW) {
  db.authReads++
  if (credential.revoked_at) return false
  if (shouldWrite(credential.last_used_at, now)) {
    db.attempts++
    if (dbAllows(db.last_used_at, now)) { db.last_used_at = new Date(now).toISOString(); db.writes++ }
  }
  return true
}
const state = (last = null) => ({ last_used_at: last, authReads: 0, attempts: 0, writes: 0 })
const credential = (last = null) => ({ last_used_at: last, revoked_at: null })
test('new credential: one write', () => { const d=state(); simulate(credential(),d); assert.equal(d.writes,1) })
test('recent credential: no update attempt', () => { const last=new Date(NOW-60000).toISOString(), d=state(last); simulate(credential(last),d); assert.equal(d.attempts,0) })
test('exact hourly boundary: write accepted', () => { const last=new Date(NOW-HOUR).toISOString(), d=state(last); simulate(credential(last),d); assert.equal(d.writes,1) })
test('older credential: write accepted', () => { const last=new Date(NOW-HOUR-1).toISOString(), d=state(last); simulate(credential(last),d); assert.equal(d.writes,1) })
test('concurrent stale reads: only one effective write', () => { const last=new Date(NOW-2*HOUR).toISOString(), d=state(last); simulate(credential(last),d); simulate(credential(last),d); assert.equal(d.attempts,2); assert.equal(d.writes,1) })
test('revoked credential: no write', () => { const d=state(); simulate({last_used_at:null,revoked_at:NOW},d); assert.equal(d.writes,0) })
test('authorization is checked every time', () => { const d=state(); simulate(credential(),d); simulate(credential(d.last_used_at),d,NOW+1000); assert.equal(d.authReads,2) })
test('future timestamp: no write', () => { const last=new Date(NOW+HOUR).toISOString(), d=state(last); simulate(credential(last),d); assert.equal(d.writes,0) })
test('invalid timestamp: update attempted but guard rejects', () => { const d=state('invalid'); simulate(credential('invalid'),d); assert.equal(d.attempts,1); assert.equal(d.writes,0) })
test('gateway and monitoring share database guard', () => { const last=new Date(NOW-2*HOUR).toISOString(), d=state(last); simulate(credential(last),d); simulate(credential(last),d); assert.equal(d.authReads,2); assert.equal(d.writes,1) })
