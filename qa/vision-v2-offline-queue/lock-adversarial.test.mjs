// Adversarial QA for the experimental mkdir/rmdir lock protocol.
// These tests intentionally demonstrate unsafe behavior; PASS means vulnerability reproduced.
// Run: node --test qa/vision-v2-offline-queue/lock-adversarial.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {withQueueLock,appendReceipt} from './locked-queue.mjs';
import {loadQueue,saveQueue} from './persistent-queue.mjs';
const receipt=n=>({event_id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,media_id:'00000000-0000-4000-8000-000000000999',played_at:'2026-11-05T12:00:00Z',completed:true,duration_seconds:15});
async function sandbox(fn){const d=await mkdtemp(join(tmpdir(),'vision-v2-adversarial-'));try{await fn(join(d,'q.json'));}finally{await rm(d,{recursive:true,force:true})}}
test('SIGKILL leaves orphan lock; further appends fail closed',()=>sandbox(async p=>{
 const script=`import {withQueueLock} from ${JSON.stringify(new URL('./locked-queue.mjs',import.meta.url).href)};await withQueueLock(process.argv[1],async()=>{process.stdout.write('LOCKED\\n');await new Promise(()=>{})});`;
 const child=spawn(process.execPath,['--input-type=module','-e',script,p],{stdio:['ignore','pipe','pipe']});
 try {
  await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(d.toString().includes('LOCKED'))resolve()});child.on('error',reject);child.on('exit',()=>reject(new Error('child exited before lock')))});
  child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));
  await assert.rejects(appendReceipt(p,receipt(1),{timeoutMs:40}),/queue_lock_unavailable/);
  await access(p+'.lock');
 } finally {if(child.exitCode===null)child.kill('SIGKILL')}
}));
test('uncooperative writer can overwrite receipts',()=>sandbox(async p=>{
 await saveQueue(p,[]);
 const a=await loadQueue(p),b=await loadQueue(p);
 await saveQueue(p,[...a,receipt(1)]);
 await saveQueue(p,[...b,receipt(2)]);
 assert.equal((await loadQueue(p)).length,1);
}));
test('lock directory replacement allows a second entrant',()=>sandbox(async p=>{
 let release,entered;
 const firstEntered=new Promise(resolve=>entered=resolve);
 const hold=new Promise(resolve=>release=resolve);
 const first=withQueueLock(p,async()=>{entered();await hold});
 await firstEntered;
 await rm(p+'.lock',{recursive:true,force:true});
 let secondEntered=false;
 await withQueueLock(p,async()=>{secondEntered=true});
 assert.equal(secondEntered,true);
 release();
 await assert.rejects(first,/ENOENT/);
}));
