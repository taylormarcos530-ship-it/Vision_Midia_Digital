// Experimental single-host lock protocol. Fail closed on orphan locks; no automatic lock stealing.
import {mkdir, rmdir} from 'node:fs/promises';
import {enqueue, acknowledge} from './offline-queue.mjs';
import {loadQueue, saveQueue} from './persistent-queue.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function withQueueLock(path, operation, {timeoutMs=2000, pollMs=10}={}) {
  if(typeof operation!=='function' || !Number.isSafeInteger(timeoutMs) || timeoutMs<0) throw new TypeError('invalid lock options');
  const lock=path+'.lock';
  const start=performance.now();
  while(true) {
    try { await mkdir(lock); break; }
    catch(e) {
      if(e.code!=='EEXIST') throw e;
      if(performance.now()-start>=timeoutMs) throw new Error('queue_lock_unavailable');
      await sleep(pollMs);
    }
  }
  try { return await operation(); }
  finally { await rmdir(lock); }
}
export async function appendReceipt(path, receipt, opts) {
  return withQueueLock(path,async()=>{
    const queue=await loadQueue(path);
    const result=enqueue(queue,receipt);
    if(result.accepted) await saveQueue(path,result.queue);
    return {accepted:result.accepted,reason:result.reason??null,count:result.queue.length};
  },opts);
}
export async function acknowledgeReceipts(path, ids, opts) {
  return withQueueLock(path,async()=>{
    const queue=await loadQueue(path);
    const next=acknowledge(queue,ids);
    if(next.length!==queue.length) await saveQueue(path,next);
    return next.length;
  },opts);
}
