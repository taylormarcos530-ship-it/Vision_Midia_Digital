// Experimental Node-only persistence harness; NOT Android storage.
// Single writer only. Atomic replace + fsync; reject corrupt state, never reset silently.
import {open, readFile, rename, mkdir, unlink} from 'node:fs/promises';
import {dirname, basename, join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {validateReceipt, MAX_PENDING} from './offline-queue.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
export async function loadQueue(path) {
  let raw;
  try { raw = await readFile(path,'utf8'); }
  catch(e) { if(e.code==='ENOENT') return []; throw e; }
  let envelope;
  try { envelope = JSON.parse(raw); } catch { throw new Error('queue_corrupt_json'); }
  if(envelope?.version!==1 || typeof envelope.payload!=='string' ||
      typeof envelope.sha256!=='string' || digest(envelope.payload)!==envelope.sha256)
    throw new Error('queue_corrupt_integrity');
  let queue;
  try { queue=JSON.parse(envelope.payload); } catch { throw new Error('queue_corrupt_payload'); }
  if(!Array.isArray(queue) || queue.length>MAX_PENDING || !queue.every(validateReceipt) ||
      new Set(queue.map(x=>x.event_id)).size!==queue.length)
    throw new Error('queue_invalid_receipts');
  return queue;
}
export async function saveQueue(path,queue) {
  if(!Array.isArray(queue) || queue.length>MAX_PENDING || !queue.every(validateReceipt) ||
      new Set(queue.map(x=>x.event_id)).size!==queue.length)
    throw new Error('queue_invalid_receipts');
  const dir=dirname(path);
  await mkdir(dir,{recursive:true});
  const payload=JSON.stringify(queue);
  const envelope=JSON.stringify({version:1,payload,sha256:digest(payload)});
  const tmp=join(dir,'.'+basename(path)+'.'+randomUUID()+'.tmp');
  let file;
  try {
    file=await open(tmp,'wx',0o600);
    await file.writeFile(envelope,'utf8');
    await file.sync();
    await file.close(); file=null;
    await rename(tmp,path);
    const directory=await open(dir,'r');
    try {await directory.sync();} finally {await directory.close();}
  } finally {
    if(file) await file.close();
    await unlink(tmp).catch(e=>{if(e.code!=='ENOENT') throw e;});
  }
}
