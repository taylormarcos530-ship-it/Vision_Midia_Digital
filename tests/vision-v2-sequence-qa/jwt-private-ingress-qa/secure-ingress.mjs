/* ONLY disposable docker networks: required ingress, old origins never joined to public.
 Two independent ingress OS containers. Redis7 holds one shared deny-only epoch.
 Can be defeated by privileged docker/network administration: not prod security proof.
 No external HTTP/DNS, no Supabase, no application secrets, no live media.
*/
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
const mode=process.argv[2],op=process.argv[3]||'';
const data=Buffer.from('synthetic-local-qa-commercial-report-'.repeat(8192));
const digest=crypto.createHash('sha256').update(data).digest('hex');
const fetchTimeout=650;
const key=(mode==='ingress'||mode==='issuer')?fs.readFileSync(process.env.QA_KEY_FILE||'/qa-key/hmac.key'):null;
if(key && key.length!==32)throw Error('QA HMAC key must contain 32 CSPRNG bytes');
const issuer='vision-v2-qa-synthetic-issuer',audience='vision-v2-qa-device-manifest';
function jwt(claims){
 const a=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
 const b=Buffer.from(JSON.stringify(claims)).toString('base64url');
 const sig=crypto.createHmac('sha256',key).update(a+'.'+b).digest('base64url');
 return a+'.'+b+'.'+sig;
}
function authJwt(value){
 try{
  if(typeof value!=='string'||!value.startsWith('Bearer ')||value.length>4096)return null;
  const parts=value.slice(7).split('.');
  if(parts.length!==3) return null;
  const [a,b,s]=parts;
  const header=JSON.parse(Buffer.from(a,'base64url').toString());
  const claims=JSON.parse(Buffer.from(b,'base64url').toString());
  if(header.alg!=='HS256'||header.typ!=='JWT'||Object.keys(header).length!==2)return null;
  const expected=crypto.createHmac('sha256',key).update(a+'.'+b).digest();
  const supplied=Buffer.from(s,'base64url');
  if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return null;
  const now=Math.floor(Date.now()/1000);
  if(claims.iss!==issuer||claims.aud!==audience||claims.scope!=='manifest:read'||
     claims.company!=='company-A'||!/^tv-[0-9]{4}$/.test(claims.device)||
     claims.term!==7||typeof claims.jti!=='string'||!/^[a-f0-9]{24}$/.test(claims.jti)||
     !Number.isInteger(claims.exp)||!Number.isInteger(claims.nbf)||!Number.isInteger(claims.iat)||
     claims.exp<=now||claims.nbf>now||claims.iat>now||claims.exp-now>300)return null;
  return claims;
 }catch{return null}
}
function sampleClaims(device='tv-0000',company='company-A'){
 const now=Math.floor(Date.now()/1000);
 return {iss:issuer,aud:audience,company,device,scope:'manifest:read',
  term:7,iat:now,nbf:now-1,exp:now+180,jti:crypto.randomBytes(12).toString('hex')};
}
if(mode==='issuer'){
 const dest=process.env.QA_ISSUE_DIR;
 if(!dest||!dest.includes('qa'))throw Error('QA fixture destination required');
 fs.mkdirSync(dest,{recursive:true});
 for(let i=0;i<15;i++){
  const device='tv-'+String(i).padStart(4,'0');
  fs.writeFileSync(dest+'/'+device+'.jwt',jwt(sampleClaims(device)),{mode:0o600});
 }
 const variants={
  expired:{...sampleClaims(),exp:Math.floor(Date.now()/1000)-2},
  future:{...sampleClaims(),nbf:Math.floor(Date.now()/1000)+120},
  wrong_aud:{...sampleClaims(),aud:'wrong'},
  wrong_tenant:sampleClaims('tv-0000','company-B'),
  wrong_device:sampleClaims('tv-9999','company-A'),
  wrong_scope:{...sampleClaims(),scope:'admin:write'},
  wrong_term:{...sampleClaims(),term:6},
 };
 for(const [name,body] of Object.entries(variants))
  fs.writeFileSync(dest+'/'+name+'.jwt',jwt(body),{mode:0o600});
 const valid=fs.readFileSync(dest+'/tv-0000.jwt','utf8');
 const [h,p,s]=valid.split('.');
 fs.writeFileSync(dest+'/tampered.jwt',h+'.'+p.slice(0,-1)+(p.at(-1)==='A'?'B':'A')+'.'+s);
 fs.writeFileSync(dest+'/none.jwt',Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')+'.'+p+'.');
 console.log('QA_JWT_ISSUER_CREATED=15, variants=9, signing key not copied to clients');
}
function tokenFile(name){
 if(!/^(tv-[0-9]{4}|expired|future|wrong_aud|wrong_tenant|wrong_device|wrong_scope|wrong_term|tampered|none)$/.test(name))
  throw Error('invalid test token filename');
 return fs.readFileSync('/qa-tokens/'+name+'.jwt','utf8').trim();
}
async function redisGet(name){
 return new Promise(resolve=>{
  const EOL=String.fromCharCode(13,10),dollar=String.fromCharCode(36);
  let done=false,received='';
  const socket=net.createConnection({host:'qa-redis',port:6379});
  const finish=value=>{
   if(done)return;
   done=true;
   socket.destroy();
   resolve(value);
  };
  socket.once('connect',()=>{
   const lines=['*2',dollar+'3','GET',dollar+String(Buffer.byteLength(name)),name,''];
   socket.write(lines.join(EOL));
  });
  socket.setTimeout(350,()=>finish(null));
  socket.on('data',part=>{
   received+=part.toString('utf8');
   if(!received.startsWith(dollar)){finish(null);return;}
   const first=received.indexOf(EOL);
   if(first<0)return;
   const n=Number(received.slice(1,first));
   if(!Number.isInteger(n)||n<0||n>2048){finish(null);return;}
   const start=first+EOL.length;
   if(received.length>=start+n+EOL.length){
    if(received.slice(start+n,start+n+EOL.length)!==EOL){finish(null);return;}
    finish(received.slice(start,start+n));
   }
  });
  socket.on('error',()=>finish(null));
  socket.on('close',()=>finish(null));
 });
}

function deny(res,status){res.writeHead(status,{'Content-Length':'0','Cache-Control':'no-store'});res.end()}
async function epoch(claims){
 const query=new URLSearchParams({device:claims.device,company:claims.company,term:String(claims.term)});
 const response=await fetch('http://qa-epoch:9300/check?'+query,{
  signal:AbortSignal.timeout(fetchTimeout),redirect:'error'
 });
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
 http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost');
   if(u.pathname!=='/check')return deny(res,404);
   const device=u.searchParams.get('device');
   const company=u.searchParams.get('company');
   const term=u.searchParams.get('term');
   if(!/^tv-[0-9]{4}$/.test(device||'')||company!=='company-A'||term!=='7')return deny(res,503);
   // Every read authorized against central epoch, per-device owner and leader term.
   const values=await Promise.all([redisGet('qa:epoch'),redisGet('qa:owner:'+device),redisGet('qa:term')]);
   if(values[0]!=='open'||values[1]!==company||values[2]!==term)return deny(res,503);
   const body='open';
   res.writeHead(200,{'Content-Length':4,'Cache-Control':'no-store'});res.end(body);
  }catch{return deny(res,503)}
 }).listen(9300,'0.0.0.0',()=>console.log('QA_JWT_FENCED_AUTHORITY_READY=1'));
}
if(mode==='ingress'){
 const origin=process.env.QA_ORIGIN;
 if(!['qa-origin-a','qa-origin-b'].includes(origin))throw Error('fixed whitelist required');
 http.createServer(async(req,res)=>{
  let claims;
  try{
   const u=new URL(req.url,'http://localhost');
   if(req.method!=='GET'||!['/normal','/pause'].includes(u.pathname))return deny(res,404);
   claims=authJwt(req.headers.authorization);
   if(!claims)return deny(res,401);
   if(u.searchParams.get('company')!==claims.company||
      u.searchParams.get('device')!==claims.device||
      u.searchParams.size!==2)return deny(res,403);
   if(!await epoch(claims))return deny(res,503);
   const upstream=await fetch('http://'+origin+':9100'+u.pathname,{
    signal:AbortSignal.timeout(3500),redirect:'error'
   });
   if(upstream.status!==200)return deny(res,503);
   res.writeHead(200,{'Content-Length':upstream.headers.get('content-length'),
    'X-QA-SHA256':upstream.headers.get('x-qa-sha256'),'Cache-Control':'no-store'});
   for await(const fragment of upstream.body){
    if(!await epoch(claims)){res.destroy();return;}
    if(!res.write(Buffer.from(fragment)))await new Promise(resolve=>res.once('drain',resolve));
   }
   res.end();
  }catch(err){if(!res.headersSent)deny(res,503);else res.destroy();}
 }).listen(9200,'0.0.0.0',()=>console.log('QA_JWT_INGRESS_READY='+origin));
}
async function read(host,route,timeout=6000,token='tv-0000',company='company-A',device='tv-0000'){
 const out={status:null,bytes:0,valid:false,aborted:false,error:null};
 const sha=crypto.createHash('sha256');
 try{
  const url='http://'+host+':9200'+route+'?'+new URLSearchParams({company,device});
  const response=await fetch(url,{
   method:'GET',
   headers:token?{'Authorization':'Bearer '+tokenFile(token)}:{},
   signal:AbortSignal.timeout(timeout),redirect:'error'
  });
  out.status=response.status;
  const expected=Number(response.headers.get('content-length'));
  const checksum=response.headers.get('x-qa-sha256');
  for await(const buf of response.body){
   out.bytes+=buf.length;sha.update(buf);
   if(route==='/pause'&&!out.sent){
    out.sent=true;console.log('QA_PAUSE_HEADER_RECEIVED=1');
   }
  }
  out.valid=out.status===200 && out.bytes===expected&&sha.digest('hex')===checksum;
 }catch(err){out.aborted=out.status===200;out.error=err.name||String(err)}
 return out;
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
 const privateIP=process.env.QA_ORIGIN_PRIVATE_IP;
 if(!privateIP || !['172','192','10'].includes(privateIP.split('.')[0]))throw Error('explicit private origin address required: '+String(privateIP));
 const ipDenied=await new Promise(resolve=>{
  const s=net.createConnection({host:privateIP,port:9100});
  s.setTimeout(450,()=>s.destroy());
  s.once('connect',()=>{s.destroy();resolve(false)});
  s.once('error',()=>resolve(true));
  s.once('close',()=>resolve(true));
 });
 denials.push({target:'origin-private-ip',denied:ipDenied});
 if(denials.some(x=>!x.denied))throw Error('private network directly reachable from client '+JSON.stringify(denials));
 console.log('QA_PRIVATE_ORIGIN_NOT_REACHABLE='+JSON.stringify(denials));
}
async function run(){
 if(op==='isolation'){
  await verifyIsolation();
  console.log('QA_JWT_PRIVATE_ISOLATION_IN_SEPARATE_CLIENT_CONTAINER=PASS');
  return;
 }
 if(op==='pre'){
  const records=await Promise.all(Array.from({length:15},(_,i)=>{
   const device='tv-'+String(i).padStart(4,'0');
   return read(i%2?'qa-ingress-b':'qa-ingress-a','/normal',6000,device,'company-A',device);
  }));
  if(records.some(x=>!x.valid))throw Error('15 JWT-valid GETs failed '+JSON.stringify(records));
  const noToken=await read('qa-ingress-a','/normal',6000,null);
  const legacy=await fetch('http://qa-ingress-a:9200/normal',{headers:{'X-QA-Token':'qa-signed-device-placeholder'}})
    .then(r=>r.status);
  const invalidPath=await read('qa-ingress-a','/forward?url=evil',6000,'tv-0000');
  const tampered=await read('qa-ingress-a','/normal',6000,'tampered');
  const expired=await read('qa-ingress-a','/normal',6000,'expired');
  const none=await read('qa-ingress-a','/normal',6000,'none');
  const future=await read('qa-ingress-a','/normal',6000,'future');
  const aud=await read('qa-ingress-a','/normal',6000,'wrong_aud');
  const scope=await read('qa-ingress-a','/normal',6000,'wrong_scope');
  const term=await read('qa-ingress-a','/normal',6000,'wrong_term');
  const wrongTenant=await read('qa-ingress-a','/normal',6000,'wrong_tenant');
  const wrongDevice=await read('qa-ingress-a','/normal',6000,'wrong_device');
  const crossTenant=await read('qa-ingress-a','/normal',6000,'tv-0000','company-B','tv-0000');
  const crossDevice=await read('qa-ingress-a','/normal',6000,'tv-0000','company-A','tv-0001');
  const actual=[noToken.status,legacy,invalidPath.status,tampered.status,expired.status,
    none.status,future.status,aud.status,scope.status,term.status,wrongTenant.status,
    wrongDevice.status,crossTenant.status,crossDevice.status];
  const expected=[401,401,404,401,401,401,401,401,401,401,401,403,403,403];
  if(JSON.stringify(actual)!==JSON.stringify(expected))
   throw Error('JWT denial mismatch '+JSON.stringify({actual,expected}));
  console.log('QA_JWT_INGRESS_PRE='+JSON.stringify({valid:15,denied:14,all_negative_status_codes:actual,
   raw_legacy_static_header_rejected:true}));
 }else if(op==='pause'){
  const x=await read('qa-ingress-a','/pause',5000);
  console.log('QA_JWT_PAUSED_HTTP='+JSON.stringify(x));
  if(x.status!==200||x.valid||!x.aborted||x.bytes<1000||x.bytes>=data.length)
   throw Error('expected HTTP200 truncated after revocation');
 }else if(op==='closed'||op==='authority-down'||op==='owner-changed'||op==='leader-changed'){
  const results=await Promise.all(Array.from({length:30},(_,i)=>{
   const device='tv-'+String(i%15).padStart(4,'0');
   return read(i%2?'qa-ingress-b':'qa-ingress-a','/normal',6000,device,'company-A',device);
  }));
  if(results.some(x=>x.valid||x.status!==503))
   throw Error('fenced JWT route bypass '+JSON.stringify(results));
  console.log('QA_JWT_INGRESS_DENIED='+JSON.stringify({count:30,scenario:op}));
 }else throw Error('unknown client verification phase '+op);
}
if(mode==='client')run().catch(e=>{console.error(e);process.exitCode=1});
+Buffer.byteLength(name)+'\r\n'+name+'\r\n');
  });
  socket.setTimeout(250,()=>finish(null));
  let buf='';
  socket.on('data',part=>{
   buf+=part.toString();
   const matched=/^\$(\d+)\r\n/.exec(buf);
   if(!matched){if(buf.includes('\r\n'))finish(null);return}
   const n=Number(matched[1]),prefix=matched[0].length;
   if(buf.length>=prefix+n+2)finish(buf.slice(prefix,prefix+n));
  });
  socket.on('error',()=>finish(null));
  socket.on('close',()=>finish(null));
 });
}
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
   let v='',answered=false;
   const finish=ok=>{
    if(answered)return;
    answered=true;
    const body=ok?'open':'closed';
    sock.end('HTTP/1.1 '+(ok?'200 OK':'503 Service Unavailable')+'\r\nContent-Length: '+body.length+'\r\nConnection: close\r\n\r\n'+body);
    conn.destroy();
   };
   conn.on('data',z=>{
    v+=z.toString('utf8');
    if(v.includes('\r\n'))finish(v.startsWith('$4\r\nopen\r\n'));
   });
   conn.on('end',()=>finish(false));
   conn.on('error',()=>finish(false));
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
 const out={status:null,bytes:0,valid:false,aborted:false,error:null};
 let sha=crypto.createHash('sha256');
 try{
  const res=await fetch('http://'+host+':9200'+route,{
   method:'GET',
   headers:token?{'X-QA-Token':'qa-signed-device-placeholder'}:{},
   signal:AbortSignal.timeout(timeout),
   redirect:'error'
  });
  out.status=res.status;
  const expected=Number(res.headers.get('content-length'));
  const checksum=res.headers.get('x-qa-sha256');
  for await(const buf of res.body){
   out.bytes+=buf.length;sha.update(buf);
   if(route==='/pause'&&!out.sent){
    out.sent=true;console.log('QA_PAUSE_HEADER_RECEIVED=1');
   }
  }
  out.valid=out.status===200 && out.bytes===expected &&
      sha.digest('hex')===checksum;
 }catch(err){
  out.aborted=out.status===200;
  out.error=err.name||String(err);
 }
 return out;
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
 const privateIP=process.env.QA_ORIGIN_PRIVATE_IP;
 if(!privateIP || !['172','192','10'].includes(privateIP.split('.')[0]))throw Error('explicit private origin address required: '+String(privateIP));
 const ipDenied=await new Promise(resolve=>{
  const s=net.createConnection({host:privateIP,port:9100});
  s.setTimeout(450,()=>s.destroy());
  s.once('connect',()=>{s.destroy();resolve(false)});
  s.once('error',()=>resolve(true));
  s.once('close',()=>resolve(true));
 });
 denials.push({target:'origin-private-ip',denied:ipDenied});
 if(denials.some(x=>!x.denied))throw Error('private network directly reachable from client '+JSON.stringify(denials));
 console.log('QA_PRIVATE_ORIGIN_NOT_REACHABLE='+JSON.stringify(denials));
}
async function run(){
 if(op==='isolation'){
  await verifyIsolation();
  console.log('QA_ISOLATION_IN_SEPARATE_UNTRUSTED_OS_CONTAINER=PASS');
  return;
 }
 if(op==='pre'){
  // Prove baseline before negative DNS/IP probes to avoid poisoning
  // the short-lived container's resolver or undici connection state.
  const one=await read('qa-ingress-a','/normal',4000);
  console.log('QA_ONE_GET='+JSON.stringify(one));
  if(!one.valid)throw Error('single ingress HTTP stream integrity failed '+JSON.stringify(one));
  const records=await Promise.all(Array.from({length:15},(_,i)=>read(i%2?'qa-ingress-b':'qa-ingress-a','/normal')));
  if(records.some(x=>!x.valid))throw Error('pre-commit 15 GET validation failed '+JSON.stringify(records));
  const unauthorized=await read('qa-ingress-a','/normal',6000,false);
  const invalidPath=await read('qa-ingress-a','/forward?url=http://qa-origin-a:9100/normal');
  if(unauthorized.status!==401||invalidPath.status!==404)throw Error('ingress auth/path validation bypass');
  console.log('QA_INGRESS_PRE='+JSON.stringify({valid:records.length,unauthorized:unauthorized.status,ssrf_rejected:invalidPath.status,private_unreachable_not_checked_in_this_process:true}));
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
