'use strict';
// All requests are loopback only. Fake credentials, fake TV, fake advertisers,
// fake media bytes. This suite must never contact Supabase or a customer device.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {once}=require('node:events');
const {augmentCommercial,decorateCommercialRows,refreshCommercialDaily,interleave}=require('../supabase/functions/_shared/commercial.mjs');
const onePixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO97GrEAAAAASUVORK5CYII=','base64');
const mockDevice='fictional-tv-only';
const base=()=>({
 updatedAt:'local-fixture-only',
 playlist:{id:'fictional-base-playlist',shuffle:false,repeat_mode:'loop'},
 items:Array.from({length:6},(_,i)=>({id:'point-'+(i+1),duration_seconds:2,essential:true,
 schedule:{enabled:false},media:{id:'point-media-'+(i+1),type:'image',url:'/point/'+(i+1),checksum:'safe-'+i}}))
});
const ads=[
 {id:'ad-alpha',advertiser:'A',name:'Ad A — fictício',media_type:'image',storage_path:'commercial-ads/local-alpha.png',duration_seconds:1,size_bytes:onePixel.length,checksum:'fake-a',width:1,height:1,start_date:'2026-10-01',end_date:'2026-12-31'},
 {id:'ad-beta',advertiser:'A',name:'Ad B — fictício',media_type:'image',storage_path:'commercial-ads/local-beta.png',duration_seconds:1,size_bytes:onePixel.length,checksum:'fake-b',width:1,height:1,start_date:'2026-10-01',end_date:'2026-12-31'}
];
async function setup(){
 const state={requests:[],logs:new Map(),daily:{A:0,B:0},rpc:[],signFails:false,server:null,url:null};
 const admin={
  rpc:async(name,params={})=>{
   state.rpc.push(name);
   if(name==='vision_commercial_manifest')return {data:ads,error:null};
   if(name==='vision_commercial_delivery')return {data:null,error:null};
   if(name==='vision_commercial_event_labels')
    return {data:ads.filter(a=>(params.p_ids||[]).includes(a.id)).map(a=>({id:a.id,name:a.name})),error:null};
   if(name==='vision_commercial_refresh_daily'){
    state.daily.A=[...state.logs.values()].filter(e=>e.advertiser==='A'&&e.completed&&e.end>e.start).length;
    return {data:null,error:null};
   }
   throw Error('unexpected_rpc_'+name);
  },
  storage:{from(bucket){
   assert.equal(bucket,'vision-media');
   return {createSignedUrls:async(paths)=>state.signFails?{error:new Error('staging_signed_url_failed')}:
    {data:paths.map(path=>({path,signedUrl:state.url+'/signed/'+path.split('/').at(-1)+'?token=local-synthetic'})),error:null}};
  }}
 };
 const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost');
  const respond=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
  state.requests.push({method:req.method,pathname:path.pathname});
  if(path.pathname.startsWith('/signed/')){
   if(req.method!=='GET'||path.searchParams.get('token')!=='local-synthetic')return respond(403,{error:'invalid_signature'});
   res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(onePixel);return;
  }
  if(path.pathname==='/report'){
   if(req.headers.authorization!=='Bearer local-anon-a'&&req.headers.authorization!=='Bearer local-anon-b')return respond(401,{error:'not_authenticated'});
   const id=req.headers.authorization.endsWith('-a')?'A':'B';
   return respond(200,{advertiser:id,completed:state.daily[id],campaigns:id==='A'?2:0});
  }
  if(req.headers['x-device-token']!=='only-local-lab-token')return respond(401,{error:'device_forbidden'});
  let payload={};
  if(req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;
   try{payload=JSON.parse(body)}catch{return respond(400,{error:'bad_json'})}
  }
  if(path.pathname==='/manifest'&&req.method==='POST'){
   const p=await augmentCommercial(admin,{id:mockDevice},base(),true,payload.enabled===true);
   return respond(200,{playlist:p,server_time:'synthetic-no-wall-clock'});
  }
  if(path.pathname==='/events'&&req.method==='POST'){
   for(const e of payload.events||[]){
    if(e.device_id!==mockDevice)return respond(403,{error:'different_device'});
    if(typeof e.id!=='string'||!e.id.startsWith('offline-event-'))return respond(400,{error:'bad_event_id'});
    if(!state.logs.has(e.id)){
     const a=ads.find(a=>a.id===e.media_id);
     state.logs.set(e.id,{...e,advertiser:a?.advertiser||null});
    }
   }
   const enriched=await decorateCommercialRows(admin,mockDevice,[...state.logs.values()],true);
   await refreshCommercialDaily(admin,mockDevice,true);
   return respond(200,{accepted:(payload.events||[]).length,stored:state.logs.size,decorated:enriched.filter(e=>e.media_name).length});
  }
  return respond(404,{error:'unknown_action'});
 });
 state.server=server;
 server.listen(0,'127.0.0.1');await once(server,'listening');
 state.url='http://127.0.0.1:'+server.address().port;
 return {state,admin,close:()=>new Promise(resolve=>server.close(resolve))};
}
const headers={'Content-Type':'application/json','x-device-token':'only-local-lab-token'};
const post=(url,payload,h=headers)=>fetch(url,{method:'POST',headers:h,body:JSON.stringify(payload)});
test('simulated connected TV receives 6 point media + 2 ads, queues offline completions and reports only valid unique playback',async()=>{
 const {state,close}=await setup();
 try{
  assert.equal((await post(state.url+'/manifest',{enabled:true},{'Content-Type':'application/json'})).status,401,'invalid device must be rejected');
  const unchanged=base(),snapshot=structuredClone(unchanged);
  const reply=await post(state.url+'/manifest',{enabled:true});
  assert.equal(reply.status,200);
  const data=await reply.json(),list=data.playlist.items;
  assert.equal(list.length,8);
  assert.deepEqual(list.filter(x=>x.id.startsWith('point-')).map(x=>x.id),snapshot.items.map(x=>x.id),'customer items are unchanged');
  assert.equal(list[3].id,'ad-alpha');
  assert.equal(list[7].id,'ad-beta');
  assert.deepEqual(unchanged,snapshot);
  assert.equal(state.rpc.filter(x=>x==='vision_commercial_manifest').length,1);
  for(const a of [list[3],list[7]]){
   assert.match(a.media.url,/^http:\/\/127\.0\.0\.1:/);
   const response=await fetch(a.media.url);
   assert.equal(response.status,200);
   assert.deepEqual(Buffer.from(await response.arrayBuffer()),onePixel);
  }
  assert.equal((await fetch(state.url+'/signed/local-alpha.png?token=wrong')).status,403,'media requires local signed URL');
  const before=(await (await fetch(state.url+'/report',{headers:{Authorization:'Bearer local-anon-a'}})).json()).completed;
  assert.equal(before,0);
  const queue=[
   {id:'offline-event-1',device_id:mockDevice,media_id:'ad-alpha',start:10,end:11,completed:true},
   {id:'offline-event-2',device_id:mockDevice,media_id:'ad-beta',start:15,end:16,completed:true},
   {id:'offline-event-3',device_id:mockDevice,media_id:'ad-beta',start:20,end:null,completed:false},
   {id:'offline-event-4',device_id:mockDevice,media_id:'ad-beta',start:30,end:29,completed:true}
  ];
  const callCountBefore=state.requests.length;
  const offlineQueue=structuredClone(queue); // no HTTP calls during simulated network failure
  assert.equal(state.requests.length,callCountBefore);
  assert.equal((await (await fetch(state.url+'/report',{headers:{Authorization:'Bearer local-anon-a'}})).json()).completed,0);
  let ack=await post(state.url+'/events',{events:offlineQueue});
  assert.equal(ack.status,200);
  assert.deepEqual(await ack.json(),{accepted:4,stored:4,decorated:4});
  ack=await post(state.url+'/events',{events:offlineQueue}); // retransmission (no double counting)
  assert.equal(ack.status,200);
  assert.deepEqual(await ack.json(),{accepted:4,stored:4,decorated:4});
  const reportA=await (await fetch(state.url+'/report',{headers:{Authorization:'Bearer local-anon-a'}})).json();
  const reportB=await (await fetch(state.url+'/report',{headers:{Authorization:'Bearer local-anon-b'}})).json();
  assert.deepEqual(reportA,{advertiser:'A',completed:2,campaigns:2});
  assert.deepEqual(reportB,{advertiser:'B',completed:0,campaigns:0});
  assert.equal((await fetch(state.url+'/report')).status,401);
 }finally{await close()}
});
test('the same local gateway never inserts ads when disabled or when signing fails',async()=>{
 const {state,close}=await setup();
 try{
  let r=await post(state.url+'/manifest',{enabled:false});let p=await r.json();
  assert.equal(p.playlist.items.length,6);
  assert.equal(state.rpc.filter(x=>x==='vision_commercial_manifest').length,0);
  state.signFails=true;
  r=await post(state.url+'/manifest',{enabled:true});p=await r.json();
  assert.equal(p.playlist.items.length,6,'failed signature must preserve all six point media');
  assert.equal(state.rpc.filter(x=>x==='vision_commercial_manifest').length,1);
  assert.equal(state.logs.size,0,'failed media signing must not create delivery events');
 }finally{await close()}
});
test('short, shuffle and single-repeat playlists still keep their original content',()=>{
 const source=base();const customer=structuredClone(source);
 const shuffle={...source,playlist:{...source.playlist,shuffle:true}};
 const single={...source,playlist:{...source.playlist,repeat_mode:'single'}};
 assert.equal(interleave(shuffle,ads),shuffle);
 assert.equal(interleave(single,ads),single);
 assert.deepEqual(source,customer);
});
