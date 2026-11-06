import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadQueue,saveQueue} from './persistent-queue.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const receipt=n=>({event_id:id(n),media_id:id(999),played_at:'2026-11-05T12:00:00Z',completed:true,duration_seconds:15});
async function sandbox(fn){const dir=await mkdtemp(join(tmpdir(),'vision-v2-'));try{await fn(join(dir,'queue.json'));}finally{await rm(dir,{recursive:true,force:true});}}
test('missing file returns empty queue',()=>sandbox(async p=>assert.deepEqual(await loadQueue(p),[])));
test('durable save and reload retains order',()=>sandbox(async p=>{await saveQueue(p,[receipt(1),receipt(2)]);assert.deepEqual(await loadQueue(p),[receipt(1),receipt(2)])}));
test('corruption fails closed',()=>sandbox(async p=>{await saveQueue(p,[receipt(1)]);await writeFile(p,(await readFile(p,'utf8')).replace('15','16'));await assert.rejects(loadQueue(p),/queue_corrupt_integrity/)}));
test('duplicate ids rejected',()=>sandbox(async p=>await assert.rejects(saveQueue(p,[receipt(1),receipt(1)]),/queue_invalid_receipts/)));
test('overwrite with acknowledged queue',()=>sandbox(async p=>{await saveQueue(p,[receipt(1),receipt(2)]);await saveQueue(p,[receipt(2)]);assert.deepEqual(await loadQueue(p),[receipt(2)])}));
test('10k receipts survive disk roundtrip',()=>sandbox(async p=>{const q=Array.from({length:10000},(_,i)=>receipt(i));await saveQueue(p,q);const loaded=await loadQueue(p);assert.equal(loaded.length,10000);assert.equal(loaded[9999].event_id,id(9999))}));
