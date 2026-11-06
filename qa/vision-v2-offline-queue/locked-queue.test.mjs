import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {appendReceipt,acknowledgeReceipts} from './locked-queue.mjs';
import {loadQueue} from './persistent-queue.mjs';
const receipt=n=>({event_id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,media_id:'00000000-0000-4000-8000-000000000999',played_at:'2026-11-05T12:00:00Z',completed:true,duration_seconds:15});
async function sandbox(fn){const dir=await mkdtemp(join(tmpdir(),'vision-locked-'));try{await fn(join(dir,'q.json'));}finally{await rm(dir,{recursive:true,force:true})}}
test('concurrent writers preserve all receipts',()=>sandbox(async p=>{await Promise.all(Array.from({length:60},(_,i)=>appendReceipt(p,receipt(i),{timeoutMs:15000})));const q=await loadQueue(p);assert.equal(q.length,60);assert.equal(new Set(q.map(x=>x.event_id)).size,60)}));
test('duplicate and ack are serialized',()=>sandbox(async p=>{await appendReceipt(p,receipt(1));const [a,b]=await Promise.all([appendReceipt(p,receipt(1)),appendReceipt(p,receipt(2))]);assert.equal(a.accepted,false);assert.equal(b.accepted,true);assert.equal(await acknowledgeReceipts(p,[receipt(1).event_id]),1)}));
test('orphan lock fails closed',()=>sandbox(async p=>{await mkdir(p+'.lock');await assert.rejects(appendReceipt(p,receipt(1),{timeoutMs:40}),/queue_lock_unavailable/);assert.deepEqual(await loadQueue(p),[])}));
test('real independent node processes append without lost updates',()=>sandbox(async p=>new Promise((resolve,reject)=>{let done=0;for(let i=0;i<8;i++){const child=spawn(process.execPath,['--input-type=module','-e',`import {appendReceipt} from ${JSON.stringify(new URL('./locked-queue.mjs',import.meta.url).href)};await appendReceipt(process.argv[1],JSON.parse(process.argv[2]),{timeoutMs:15000});`,p,JSON.stringify(receipt(i))],{stdio:'pipe'});let err='';child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>{if(code!==0)return reject(new Error(err));if(++done===8)loadQueue(p).then(q=>{try{assert.equal(q.length,8);resolve()}catch(e){reject(e)}},reject)})}})));
