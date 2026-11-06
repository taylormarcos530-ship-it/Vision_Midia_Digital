// Reproduced on Node 22 local disposable QA. PASS means negative attack was reproduced.
// Security gates remain FAIL; no production readiness implied.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,rename,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {appendReceipt,readReceipts} from './receipt-spool.mjs';
const receipt=n=>({event_id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,media_id:'00000000-0000-4000-8000-000000000999',played_at:'2026-11-05T12:00:00Z',completed:true,duration_seconds:15});
async function sandbox(fn){const d=await mkdtemp(join(tmpdir(),'vision-spool-sec-'));try{await fn(d)}finally{await rm(d,{recursive:true,force:true})}}
test('NEGATIVE: matching unkeyed digest allows forged receipt',()=>sandbox(async d=>{await appendReceipt(d,receipt(1));const p=join(d,receipt(1).event_id+'.json');const env=JSON.parse(await readFile(p,'utf8'));env.payload=JSON.stringify({...JSON.parse(env.payload),duration_seconds:3600});env.sha256=createHash('sha256').update(env.payload).digest('hex');await writeFile(p,JSON.stringify(env));assert.equal((await readReceipts(d))[0].duration_seconds,3600)}));
test('NEGATIVE: replacing spool directory hides previous receipts',()=>sandbox(async d=>{const p=join(d,'active');await appendReceipt(p,receipt(1));await rename(p,join(d,'hidden'));await mkdir(p);assert.deepEqual(await readReceipts(p),[]);await appendReceipt(p,receipt(2));assert.equal((await readReceipts(p)).length,1);assert.equal((await readReceipts(join(d,'hidden'))).length,1)}));
test('SIGKILL before publish leaves only ignored temp file',()=>sandbox(async d=>{const p=join(d,'active');await mkdir(p);const code=`import {open} from 'node:fs/promises';import {join} from 'node:path';const h=await open(join(process.argv[1],'.interrupted.tmp'),'wx');await h.writeFile('incomplete');process.stdout.write('READY\\n');await new Promise(()=>{});`;const c=spawn(process.execPath,['--input-type=module','-e',code,p]);try{await new Promise((resolve,reject)=>{c.stdout.on('data',b=>{if(b.toString().includes('READY'))resolve()});c.on('error',reject);c.on('exit',()=>reject(Error('early exit')))});c.kill('SIGKILL');await new Promise(resolve=>c.once('exit',resolve));assert.deepEqual(await readReceipts(p),[]);assert.ok((await readdir(p)).some(x=>x.endsWith('.tmp')))}finally{if(c.exitCode===null)c.kill('SIGKILL')}}));
