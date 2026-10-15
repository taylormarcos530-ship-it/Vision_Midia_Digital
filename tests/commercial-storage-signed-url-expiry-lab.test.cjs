// OFFLINE LAB: synthetic bearer signed URLs, expiry, access revocation and CDN caching.
// This code does NOT implement Supabase's signing or caching algorithms.
// NEVER use these synthetic tokens as production credentials or URLs.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHmac,timingSafeEqual}=require('node:crypto');
const fs=require('node:fs');

const host='https://fixture-storage.invalid';
const bucket='vision-media';
const commercial='commercial-ads/00000000-0000-4000-8000-000000000301.webp';
const otherCopy='commercial-ads/00000000-0000-4000-8000-000000000302.webp';
const original='private-owner/customer-original.webp';
const t0=1000000;
const maxTtl=60;
const photo='synthetic bytes only';
const salt='FIXTURE_KEY_NOT_A_SUPABASE_SECRET';
const pathRegex=/^commercial-ads\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:png|jpe?g|webp|mp4)$/;

function sandbox({cacheSeconds=0}={}){
 const users=new Map([
  ['advertiser-A',{enabled:true,session:'session-A'}],
  ['advertiser-B',{enabled:true,session:'session-B'}]
 ]);
 const objects=new Map([
  [commercial,{owner:'advertiser-A',payload:photo}],
  [otherCopy,{owner:'advertiser-B',payload:'copy B'}],
  [original,{owner:'the-establishment',payload:'original must be private'}]
 ]);
 const cache=new Map();
 const audit=[];
 let counter=0;
 const signature=payload=>createHmac('sha256',salt).update(payload).digest('base64url');
 const tokenFor=data=>{
  const serialized=Buffer.from(JSON.stringify(data)).toString('base64url');
  return serialized+'.'+signature(serialized);
 };
 function signed({advertiser,path,session,seconds=maxTtl,now=t0}){
  const user=users.get(advertiser),object=objects.get(path);
  if(!user||!user.enabled||session!==user.session)return {ok:false,status:403,reason:'account_or_session_denied'};
  if(!Number.isInteger(seconds)||seconds<1||seconds>maxTtl)return {ok:false,status:400,reason:'invalid_ttl'};
  if(!pathRegex.test(path)||!object||object.owner!==advertiser)return {ok:false,status:403,reason:'wrong_commercial_object'};
  const payload={bucket,path,exp:now+seconds,nonce:++counter};
  const token=tokenFor(payload);
  audit.push({event:'issued',advertiser,path,exp:payload.exp}); // No bearer tokens in audit.
  return {ok:true,status:200,url:host+'/storage/v1/object/sign/'+bucket+'/'+path+'?token='+token,expiresAt:payload.exp};
 }
 function parse(url){
  try{
   const u=new URL(url);
   if(u.origin!==host||u.searchParams.size!==1)return null;
   const token=u.searchParams.get('token');
   if(typeof token!=='string'||token.length>4000)return null;
   const parts=token.split('.');
   if(parts.length!==2)return null;
   const expected=signature(parts[0]);
   const actual=Buffer.from(parts[1]);
   const signatureBytes=Buffer.from(expected);
   if(actual.length!==signatureBytes.length||!timingSafeEqual(actual,signatureBytes))return null;
   const data=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
   const expectedUrl=host+'/storage/v1/object/sign/'+bucket+'/'+data.path;
   if(data.bucket!==bucket||!Number.isInteger(data.exp)||u.origin+u.pathname!==expectedUrl)return null;
   return data;
  }catch{return null}
 }
 function read(url,now=t0,{cdn=false}={}){
  // Only a deliberately simplified lab model of potential CDN behavior.
  // A cache can serve a previously fetched body without rechecking token expiry.
  const hit=cdn?cache.get(url):null;
  if(hit&&now<hit.cachedUntil)return {status:200,body:hit.body,source:'cached'};
  const claims=parse(url);
  if(!claims)return {status:403,source:'origin'};
  if(now>=claims.exp)return {status:403,source:'origin',reason:'expired'};
  const object=objects.get(claims.path);
  if(!object)return {status:404,source:'origin'};
  if(cdn&&cacheSeconds>0)cache.set(url,{body:object.payload,cachedUntil:now+cacheSeconds});
  return {status:200,body:object.payload,source:'origin'};
 }
 function revoke(advertiser){
  const x=users.get(advertiser);if(x){x.enabled=false; x.session='revoked';}
 }
 function rotateSession(advertiser,newSession){
  users.get(advertiser).session=newSession;
 }
 function proxyRead({advertiser,session,path,now=t0,range=null}){
  // An EXAMPLE of a future authorization-enforcing gateway, not deployed code.
  const u=users.get(advertiser),obj=objects.get(path);
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
  if(!u||!u.enabled||u.session!==session||!obj||obj.owner!==advertiser||!pathRegex.test(path)){
   return {status:403,headers};
  }
  const body=String(obj.payload);
  if(range===null)return {status:200,headers,body};
  const match=/^bytes=(\d+)-(\d*)$/.exec(range);
  if(!match)return {status:416,headers};
  const begin=Number(match[1]);
  const end=match[2]?Number(match[2]):body.length-1;
  if(begin>=body.length||end<begin||end>=body.length)return {status:416,headers};
  return {status:206,headers:{...headers,'Content-Range':'bytes '+begin+'-'+end+'/'+body.length},body:body.slice(begin,end+1)};
 }
 return {signed,read,revoke,rotateSession,proxyRead,users,objects,audit,cache};
}
const mint=(s,args={})=>s.signed({advertiser:'advertiser-A',session:'session-A',path:commercial,...args});

test('normal short-lived URL is issued for the advertising snapshot only',()=>{
 const s=sandbox();
 const grant=mint(s);
 assert.equal(grant.ok,true);
 assert.equal(grant.expiresAt,t0+60);
 assert.equal(s.read(grant.url,t0).status,200);
 assert.equal(s.read(grant.url,t0+59).status,200);
 assert.equal(s.audit.length,1);
 assert.equal(JSON.stringify(s.audit).includes('token='),false);
});
test('synthetic signed URL expires exactly at its origin deadline without CDN cache',()=>{
 const s=sandbox(),grant=mint(s);
 assert.equal(s.read(grant.url,t0+59).status,200);
 assert.equal(s.read(grant.url,t0+60).status,403);
 assert.equal(s.read(grant.url,t0+61).status,403);
});
test('logout/revoke prevents NEW signing but does NOT revoke an issued bearer URL',()=>{
 const s=sandbox(),grant=mint(s);
 s.revoke('advertiser-A');
 assert.deepEqual(mint(s).ok,false);
 assert.equal(s.read(grant.url,t0+1).status,200,'existing bearer remains available before expiry');
 assert.equal(s.read(grant.url,t0+60).status,403);
});
test('changing the Auth session/JWT does not invalidate an already minted URL',()=>{
 const s=sandbox(),grant=mint(s);
 s.rotateSession('advertiser-A','session-A-rotated');
 assert.equal(mint(s).status,403);
 assert.equal(s.read(grant.url,t0+20).status,200);
 const newGrant=mint(s,{session:'session-A-rotated',now:t0+20});
 assert.equal(newGrant.status,200);
});
test('future signing refuses stranger, unrelated advertiser, owner media and unlisted paths',()=>{
 const s=sandbox();
 const cases=[
  {advertiser:'outsider',session:'fake',path:commercial},
  {advertiser:'advertiser-B',session:'session-B',path:commercial},
  {advertiser:'advertiser-A',session:'session-A',path:otherCopy},
  {advertiser:'advertiser-A',session:'session-A',path:original},
  {advertiser:'advertiser-A',session:'session-A',path:'commercial-ads/../private-owner/file.webp'}
 ];
 for(const c of cases)assert.equal(s.signed(c).ok,false,JSON.stringify(c));
 assert.equal(s.audit.length,0);
});
test('requested lifetime is fail-closed to 1-60s in this proposed policy only',()=>{
 const s=sandbox();
 for(const seconds of [0,-1,61,3600,1.5,NaN,null])
  assert.equal(mint(s,{seconds}).ok,false,'ttl '+seconds);
 assert.equal(mint(s,{seconds:1}).expiresAt,t0+1);
 assert.equal(mint(s,{seconds:60}).expiresAt,t0+60);
});
test('tampering with URL path, signature, host or query cannot authorize origin fetch',()=>{
 const s=sandbox(),grant=mint(s);
 const u=new URL(grant.url);
 const alternate=u.pathname.replace(commercial,otherCopy);
 const cases=[
  host+alternate+u.search,
  grant.url+'&extra=1',
  grant.url.replace('fixture-storage.invalid','outside.invalid'),
  grant.url.replace('token=','token=changed'),
  grant.url.replace(commercial,original),
  grant.url.replace('?token=','?signature=')
 ];
 for(const url of cases)assert.equal(s.read(url,t0+5).status,403);
});
test('CDN model shows why token expiry alone is NOT an immediate-access guarantee',()=>{
 const s=sandbox({cacheSeconds:180}),grant=mint(s);
 assert.equal(s.read(grant.url,t0,{cdn:true}).source,'origin');
 s.revoke('advertiser-A');
 const afterExpiry=s.read(grant.url,t0+70,{cdn:true});
 assert.equal(afterExpiry.source,'cached');
 assert.equal(afterExpiry.status,200,'an already cached response can outlive signed token expiry');
 const afterCache=s.read(grant.url,t0+180,{cdn:true});
 assert.equal(afterCache.status,403);
 assert.equal(afterCache.reason,'expired');
});
test('each unique signature can have an independent cache entry even for the same commercial copy',()=>{
 const s=sandbox({cacheSeconds:120}),one=mint(s);
 const two=mint(s,{now:t0+1});
 assert.notEqual(one.url,two.url);
 assert.equal(s.read(one.url,t0,{cdn:true}).source,'origin');
 assert.equal(s.read(two.url,t0+1,{cdn:true}).source,'origin');
 assert.equal(s.cache.size,2);
});
test('a server-authorized no-store proxy model can refuse access immediately after revocation',()=>{
 const s=sandbox();
 const before=s.proxyRead({advertiser:'advertiser-A',session:'session-A',path:commercial});
 assert.equal(before.status,200);
 assert.equal(before.headers['Cache-Control'],'private, no-store');
 s.revoke('advertiser-A');
 const after=s.proxyRead({advertiser:'advertiser-A',session:'session-A',path:commercial});
 assert.equal(after.status,403);
 // This does NOT invalidate a bearer signed URL issued through Supabase.
});
test('server-authorized video byte ranges must check authorization on every request',()=>{
 const s=sandbox(),access={advertiser:'advertiser-A',session:'session-A',path:commercial};
 const bytes=s.proxyRead({...access,range:'bytes=0-4'});
 assert.equal(bytes.status,206);
 assert.equal(bytes.headers['Content-Range'],'bytes 0-4/'+photo.length);
 assert.equal(bytes.body,'synth');
 s.revoke('advertiser-A');
 assert.equal(s.proxyRead({...access,range:'bytes=5-8'}).status,403);
});
test('proposed no-store proxy also isolates tenants and rejects invalid ranges',()=>{
 const s=sandbox();
 assert.equal(s.proxyRead({advertiser:'advertiser-B',session:'session-B',path:commercial}).status,403);
 assert.equal(s.proxyRead({advertiser:'advertiser-A',session:'session-A',path:original}).status,403);
 assert.equal(s.proxyRead({advertiser:'advertiser-A',session:'session-A',path:commercial,range:'bytes=999-1000'}).status,416);
});
test('removing a synthetic commercial copy does not remove any original establishment media',()=>{
 const s=sandbox(),grant=mint(s);
 s.objects.delete(commercial);
 assert.equal(s.read(grant.url,t0+2).status,404,'origin fetch fails after hypothetical copy deletion');
 assert.equal(s.objects.has(original),true,'original remains untouched');
});
test('current portal requests 60-second signatures and real SQL remains unchanged by lab',()=>{
 const ui=fs.readFileSync('commercial-ui.mjs','utf8');
 const sql=fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8');
 assert.match(ui,/body:\{expiresIn:60\}/);
 assert.match(sql,/commercial_thumbnail_self/);
 assert.match(sql,/storage\.objects/);
 assert.doesNotMatch(sql,/commercial-storage-signed-url-expiry-lab/);
 assert.doesNotMatch(fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8'),/commercial-storage-signed-url-expiry-lab/);
});
