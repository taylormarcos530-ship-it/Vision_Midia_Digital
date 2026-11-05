/* ONLY disposable docker networks: required ingress, old origins never joined to public.
 Two independent ingress OS containers. Redis7 holds one shared deny-only epoch.
 Can be defeated by privileged docker/network administration: not prod security proof.
 No external HTTP/DNS, no Supabase, no application secrets, no live media.
*/
import http from 'node:http';
import crypto from 'node:crypto';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
const mode=process.argv[2],op=process.argv[3]||'';
const data=Buffer.from('synthetic-local-qa-commercial-report-'.repeat(8192));
const digest=crypto.createHash('sha256').update(data).digest('hex');
const fetchTimeout=200;
function deny(res,status){res.writeHead(status,{'Content-Length':'0','Cache-Control':'no-store'});res.end()}
async function epoch(){
 const response=await fetch('http://qa-epoch:9300/check',{signal:AbortSignal.timeout(fetchTimeout)});
 return response.ok && (await response.text())==='open';
}
if(mode==='origin'){
 http.createServer(async(req,res)=>{
  if(!['/normal','/pause'].includes(req.url))return deny(res,404);
  res.writeHead(200,{'Content-Length':String(data.length),'X-QA-SHA256':digest,'Cache-Control':'no-store'});
  if(req.url==='/pause'){
   res.write(data.subarray(0,65536));
   await delay(1600);
   res.end(data.subarray(65536));
  }else res.end(data);
 }).listen(9100,'0.0.0.0',()=>console.log('QA_PRIVATE_ORIGIN_READY=1'));
}
if(mode==='epoch'){
 const sockets=[];
 const server=net.createServer(sock=>{
  sockets.push(sock);
  let payload='';
  sock.on('data',chunk=>{payload+=chunk.toString('utf8');
   if(!payload.includes('\r\n'))return;
   const first=payload.split('\r\n')[0];
   if(first!=='GET /check HTTP/1.1'){sock.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');return}
   const conn=net.createConnection({host:'qa-redis',port:6379},()=>{
    conn.write('*2\r\n$3\r\nGET\r\n$8\r\nqa:epoch\r\n');
   });
   conn.setTimeout(150,()=>conn.destroy());
   let v='';
   conn.on('data',z=>v+=z.toString('utf8'));
   conn.on('end',()=>{
    const ok=v.includes('\r\n4\r\nopen\r\n');
    const body=ok?'open':'closed';
    sock.end('HTTP/1.1 '+(ok?'200 OK':'503 Service Unavailable')+'\r\nContent-Length: '+body.length+'\r\nConnection: close\r\n\r\n'+body);
   });
   conn.on('error',()=>{if(!sock.destroyed)sock.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')});
  });
 });
 server.listen(9300,'0.0.0.0',()=>console.log('QA_EPOCH_AUTHORITY_READY=1'));
}
if(mode==='ingress'){
 const origin=process.env.QA_ORIGIN;
 if(!['qa-origin-a','qa-origin-b'].includes(origin))throw Error('fixed whitelist required');
 http.createServer(async(req,res)=>{
  if(req.method!=='GET'||!['/normal','/pause'].includes(req.url))return deny(res,404);
  if(req.headers['x-qa-token']!=='qa-signed-device-placeholder')return deny(res,401);
  try{
   if(!await epoch())return deny(res,503);
   const upstream=await fetch('http://'+origin+':9100'+req.url,{signal:AbortSignal.timeout(3500),redirect:'error'});
   if(upstream.status!==200)return deny(res,503);
   res.writeHead(200,{'Content-Length':upstream.headers.get('content-length'),
    'X-QA-SHA256':upstream.headers.get('x-qa-sha256'),'Cache-Control':'no-store'});
   for await(const fragment of upstream.body){
    if(!await epoch()){res.destroy();return;}
    if(!res.write(Buffer.from(fragment)))await new Promise(resolve=>res.once('drain',resolve));
   }
   res.end();
  }catch(err){if(!res.headersSent)deny(res,503);else res.destroy();}
 }).listen(9200,'0.0.0.0',()=>console.log('QA_INGRESS_READY='+origin));
}
async function read(host,route,timeout=6000,token=true){
 return new Promise(resolve=>{
  const out={status:null,bytes:0,valid:false,aborted:false,error:null};
  const req=http.get({hostname:host,port:9200,path:route,headers:token?{'X-QA-Token':'qa-signed-device-placeholder'}:{},timeout},res=>{
   out.status=res.statusCode;
   let hash=crypto.createHash('sha256');
   res.on('data',buf=>{out.bytes+=buf.length;hash.update(buf);
    if(route==='/pause'&&!out.sent) {out.sent=true;console.log('QA_PAUSE_HEADER_RECEIVED=1');}
   });
   res.on('end',()=>{
    out.valid=res.statusCode===200 && out.bytes===Number(res.headers['content-length'])
      && hash.digest('hex')===res.headers['x-qa-sha256'];
    resolve(out);
   });
   res.on('aborted',()=>{out.aborted=true;resolve(out)});
   res.on('close',()=>{if(!res.complete){out.aborted=true;resolve(out)}});
  });
  req.on('error',e=>{out.error=e.code||e.message;resolve(out)});
  req.on('timeout',()=>req.destroy(new Error('timeout')));
 });
}
async function verifyIsolation(){
 const destinations=['qa-origin-a','qa-origin-b','qa-epoch','qa-redis'];
 const denials=[];
 for(const target of destinations){
  const result=await new Promise(resolve=>{
   const s=net.createConnection({host:target,port:target==='qa-redis'?6379:target==='qa-epoch'?9300:9100});
   s.setTimeout(300,()=>s.destroy());
   s.on('connect',()=>{s.destroy();resolve(false)});
   s.on('error',()=>resolve(true));
   s.on('close',()=>resolve(true));
  });
  denials.push({target,denied:result});
 }
 if(denials.some(x=>!x.denied))throw Error('private network directly reachable from client '+JSON.stringify(denials));
 console.log('QA_PRIVATE_ORIGIN_NOT_REACHABLE='+JSON.stringify(denials));
}
async function run(){
 if(op==='pre'){
  await verifyIsolation();
  const records=await Promise.all(Array.from({length:15},(_,i)=>read(i%2?'qa-ingress-b':'qa-ingress-a','/normal')));
  if(records.some(x=>!x.valid))throw Error('pre-commit 15 GET validation failed '+JSON.stringify(records));
  const unauthorized=await read('qa-ingress-a','/normal',6000,false);
  const invalidPath=await read('qa-ingress-a','/forward?url=http://qa-origin-a:9100/normal');
  if(unauthorized.status!==401||invalidPath.status!==404)throw Error('ingress auth/path validation bypass');
  console.log('QA_INGRESS_PRE='+JSON.stringify({valid:records.length,unauthorized:unauthorized.status,ssrf_rejected:invalidPath.status,private_unreachable:true}));
 }else if(op==='pause'){
  const x=await read('qa-ingress-a','/pause',5000);
  console.log('QA_PAUSED_HTTP='+JSON.stringify(x));
  if(x.status!==200||x.valid||!x.aborted||x.bytes<1000||x.bytes>=data.length)throw Error('expected HTTP200 truncated after revocation');
 }else if(op==='closed'||op==='authority-down'){
  const results=await Promise.all(Array.from({length:30},(_,i)=>read(i%2?'qa-ingress-b':'qa-ingress-a','/normal')));
  if(results.some(x=>x.valid||x.status!==503))throw Error('closed epoch bypass '+JSON.stringify(results));
  console.log('QA_INGRESS_DENIED='+JSON.stringify({count:results.length,closed:true,authority_down:op==='authority-down'}));
 }else throw Error('unknown client verification phase '+op);
}
if(mode==='client')run().catch(e=>{console.error(e);process.exitCode=1});
