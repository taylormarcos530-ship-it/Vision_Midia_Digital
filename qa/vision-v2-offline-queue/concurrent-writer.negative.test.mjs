// Negative security regression: intentionally FAILS until multiwriter fencing is implemented.
// Run separately: node --test qa/vision-v2-offline-queue/concurrent-writer.negative.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadQueue,saveQueue} from './persistent-queue.mjs';
const receipt=n=>({event_id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,media_id:'00000000-0000-4000-8000-000000000999',played_at:'2026-11-05T12:00:00Z',completed:true,duration_seconds:15});
test('concurrent writers must not silently lose receipts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vision-v2-race-'));
 try {
  const path=join(dir,'queue.json');
  await saveQueue(path,[]);
  const [a,b]=await Promise.all([loadQueue(path),loadQueue(path)]);
  await Promise.all([saveQueue(path,[...a,receipt(1)]),saveQueue(path,[...b,receipt(2)])]);
  assert.equal((await loadQueue(path)).length,2,'lost update: one writer overwrote the other');
 } finally { await rm(dir,{recursive:true,force:true}); }
});
