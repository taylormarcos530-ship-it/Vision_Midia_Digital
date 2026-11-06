// Experimental single-host spool. Unique immutable files avoid shared read/modify/write.
// This is NOT resistant to a privileged writer deleting files or replacing the directory.
import {mkdir,open,readFile,readdir,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha=x=>createHash('sha256').update(x).digest('hex');
const valid=x=>x&&typeof x==='object'&&!Array.isArray(x)&&uuid.test(x.event_id)&&uuid.test(x.media_id)&&typeof x.completed==='boolean'&&typeof x.played_at==='string'&&Number.isFinite(Date.parse(x.played_at))&&Number.isFinite(x.duration_seconds)&&x.duration_seconds>=0&&x.duration_seconds<=86400;
async function syncDir(path){const h=await open(path,'r');try{await h.sync()}finally{await h.close()}}
export async function appendReceipt(root,receipt){
 if(!valid(receipt))throw Error('invalid_receipt');
 await mkdir(root,{recursive:true});
 const name=receipt.event_id.toLowerCase()+'.json';
 const payload=JSON.stringify(receipt);const data=JSON.stringify({payload,sha256:sha(payload)});
 const temp=join(root,'.'+randomUUID()+'.tmp');
 let handle;
 try{handle=await open(temp,'wx',0o600);await handle.writeFile(data);await handle.sync();await handle.close();handle=null;
 try{await link(temp,join(root,name))}catch(e){if(e.code==='EEXIST')return false;throw e}
 await syncDir(root);return true;
 }finally{if(handle)await handle.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
}
export async function readReceipts(root){
 let names;try{names=(await readdir(root)).filter(n=>uuid.test(n.slice(0,-5))&&n.endsWith('.json')).sort()}catch(e){if(e.code==='ENOENT')return [];throw e}
 const results=[];
 for(const name of names){let env;try{env=JSON.parse(await readFile(join(root,name),'utf8'))}catch{throw Error('corrupt_receipt:'+name)}
 if(typeof env.payload!=='string'||sha(env.payload)!==env.sha256)throw Error('corrupt_receipt:'+name);
 let receipt;try{receipt=JSON.parse(env.payload)}catch{throw Error('corrupt_receipt:'+name)}
 if(!valid(receipt)||receipt.event_id.toLowerCase()+'.json'!==name)throw Error('invalid_receipt:'+name);
 results.push(receipt)}return results;
}
