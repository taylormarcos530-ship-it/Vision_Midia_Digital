'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const mediaPath='point/original.webp';
const point=n=>({id:'original-item-'+n,media:{id:'original-media-'+n,name:'Mídia do estabelecimento '+n,type:'image'},duration_seconds:2,schedule:{enabled:false}});
const base=()=>({updatedAt:'original-unchanged',playlist:{id:'establishment-playlist',shuffle:false,repeat_mode:'all'},items:Array.from({length:6},(_,i)=>point(i+1))});
async function database(){
 const db=new PGlite();
 await db.exec("create role anon; create role authenticated; create role service_role bypassrls;"+
 "create schema auth;create schema private;create schema storage;"+
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
 "grant usage on schema public,auth,private to authenticated,service_role,anon;"+
 "grant execute on function auth.uid() to authenticated,service_role;"+
 "create table auth.users(id uuid primary key);"+
 "create table public.platform_admins(user_id uuid,role text,status text);"+
 "create table public.company_members(user_id uuid);"+
 "create table public.companies(id uuid primary key,name text,owner_user_id uuid);"+
 "create table public.devices(id uuid primary key,company_id uuid,name text,last_seen_at timestamptz,retired_at timestamptz);"+
 "create table public.media_assets(id uuid primary key,name text,media_type text,storage_path text,source_url text,duration_seconds numeric,size_bytes bigint,checksum_sha256 text,width int,height int,processing_status text,updated_at timestamptz);"+
 "create table public.playback_logs(id uuid primary key default gen_random_uuid(),device_id uuid,client_event_id text,media_id uuid,started_at timestamptz,ended_at timestamptz,completed boolean,created_at timestamptz default now(),unique(device_id,client_event_id));"+
 "create table storage.objects(bucket_id text,name text);"+
 "alter table storage.objects enable row level security;"+
 "grant select on storage.objects to authenticated;grant usage on schema storage to authenticated;");
 await db.exec("insert into auth.users values('"+id(1)+"'),('"+id(2)+"'),('"+id(3)+"'),('"+id(4)+"');"+
 "insert into platform_admins values('"+id(1)+"','super_admin','active');"+
 "insert into company_members values('"+id(4)+"');"+
 "insert into companies values('"+id(10)+"','LAB - Estabelecimento','"+id(4)+"');"+
 "insert into devices values('"+id(20)+"','"+id(10)+"','LAB - TV',now(),null);"+
 "insert into media_assets values('"+id(30)+"','Criativo A','image','"+
 mediaPath+"',null,15,120,'hash-source-a',1920,1080,'ready',now()),('"+
 id(31)+"','Criativo B','image','point/second.webp',null,15,130,'hash-source-b',1920,1080,'ready',now());");
 await db.exec(fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8'));
 await db.exec("insert into vision_advertisers(id,user_id,name,email) values('"+
 id(40)+"','"+id(2)+"','Anunciante A','a@example.test'),('"+
 id(41)+"','"+id(3)+"','Anunciante B','b@example.test');");
 return db;
}
function backend(db){
 const trace={copies:[],signed:[],rpc:[],remove:[]};
 const queries={
  media_assets:new Set(['id']),
 };
 const from=table=>{
  const predicates=[];let columns='*';
  const q={
   select(v){columns=v;return q},
   eq(k,v){predicates.push([k,v]);return q},
   async maybeSingle(){
    if(!queries[table])throw Error('unexpected_table_'+table);
    if(predicates.some(([key])=>!queries[table].has(key)))throw Error('unexpected_filter');
    const where=predicates.map(([k],i)=>k+'=$'+(i+1)).join(' and ');
    const result=await db.query('select '+columns+' from public.'+table+(where?' where '+where:'')+' limit 1',predicates.map(x=>x[1]));
    return {data:result.rows[0]||null,error:null};
   }
  };
  return q;
 };
 const rpc=async(name,args={})=>{
  trace.rpc.push(name);
  if(name==='vision_commercial_delivery')return {data:null,error:null};
  if(name==='vision_commercial_save_campaign'){
   const res=await db.query('select public.vision_commercial_save_campaign($1,$2::jsonb) as result',[args.p_actor,JSON.stringify(args.p_data)]);
   return {data:res.rows[0].result,error:null};
  }
  if(name==='vision_commercial_manifest'){
   const res=await db.query('select public.vision_commercial_manifest($1) as result',[args.p_device]);
   return {data:res.rows[0].result,error:null};
  }
  if(name==='vision_commercial_refresh_daily'){
   await db.query('select public.vision_commercial_refresh_daily($1)',[args.p_device]);
   return {data:null,error:null};
  }
  if(name==='vision_commercial_master_report'){
   const result=await db.query('select public.vision_commercial_master_report($1,$2) as result',[args.p_actor,args.p_advertiser]);
   return {data:result.rows[0].result,error:null};
  }
  if(name==='vision_commercial_event_labels'){
   const result=await db.query('select public.vision_commercial_event_labels($1,$2::uuid[]) as result',[args.p_device,args.p_ids]);
   return {data:result.rows[0].result,error:null};
  }
  throw Error('unexpected_rpc_'+name);
 };
 const storage={from(bucket){
   assert.equal(bucket,'vision-media');
   return {
    async copy(original,destination){
     assert.match(destination,/^commercial-ads\/[a-f0-9-]{36}\.webp$/);
     trace.copies.push({original,destination});
     await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['vision-media',destination]);
     return {error:null};
    },
    async createSignedUrls(paths){
     trace.signed.push(...paths);
     return {data:paths.map(path=>({path,signedUrl:'https://fictional.invalid/signed/'+path})),error:null};
    },
    async remove(paths){trace.remove.push(...paths);return {error:null};}
   };
 }};
 return {admin:{from,rpc,storage},trace};
}
async function portal(db,user){
 await db.exec('set role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(user)]);
 try {const result=await db.query('select public.vision_advertiser_portal() as data');return result.rows[0].data;}
 finally {await db.exec('reset role');}
}
test('Master -> immutable ad snapshot -> Player manifest -> telemetry -> advertiser report (2 tenants)',async()=>{
 const db=await database();
 try{
  const {commercialMaster}=await import('../supabase/functions/_shared/commercial-master.mjs');
  const {augmentCommercial,decorateCommercialRows,refreshCommercialDaily}=await import('../supabase/functions/_shared/commercial.mjs');
  const {admin,trace}=backend(db);
  const original=base(),snapshot=JSON.stringify(original);
  const make=(advertiser,media,name)=>commercialMaster(admin,{id:id(1)},'super_admin',{
   action:'commercial_save_campaign',
   campaign:{advertiser_id:id(advertiser),media_id:id(media),name,start_date:'2026-01-01',
    end_date:'2027-12-31',device_ids:[id(20)],status:'active'}
  });
  const [a,b]=[await make(40,30,'Campanha A'),await make(41,31,'Campanha B')];
  assert.equal(a.ok,true);assert.equal(b.ok,true);
  assert.equal(a.snapshot_used,true);assert.equal(b.snapshot_used,true);
  assert.equal(trace.copies.length,2);
  assert.deepEqual(trace.copies.map(x=>x.original),['point/original.webp','point/second.webp']);
  const manifest=await augmentCommercial(admin,{id:id(20)},original,true,true,'America/Sao_Paulo',0);
  assert.equal(manifest.items.length,8);
  assert.deepEqual(manifest.items.map(x=>x.commercial===true),[false,false,false,true,false,false,false,true]);
  assert.equal(JSON.stringify(original),snapshot,'point playlist must remain untouched');
  const commercial=manifest.items.filter(x=>x.commercial);
  assert.equal(commercial.length,2);
  commercial.forEach(x=>assert.match(x.media.url,/^https:\/\/fictional.invalid\/signed\/commercial-ads\//));
  assert.equal(trace.signed.length,2);
  const player=fs.readFileSync('player.js','utf8');
  const match=player.match(/  function findNewPointMediaPriority\(previousItems, nextItems, timeZone\) \{[\s\S]*?\n  \}/);
  assert.ok(match);
  const context={itemScheduleActive:()=>true};
  vm.runInNewContext(match[0]+';this.priority=findNewPointMediaPriority',context);
  assert.equal(context.priority(original.items,manifest.items,'America/Sao_Paulo'),null,'advertisements must not jump to first item');
  const entry=(k,media,completed,start,end)=>({
   client_event_id:k,media_id:media,started_at:new Date(Date.now()-start*1000),
   ended_at:new Date(Date.now()-end*1000),completed
  });
  const events=[entry('first',commercial[0].media.id,true,50,35),
   entry('failed',commercial[0].media.id,false,30,25),
   entry('second',commercial[1].media.id,true,40,20)];
  const names=await decorateCommercialRows(admin,id(20),events,true);
  assert.equal(names.filter(x=>x.campaign_name==='Publicidade comercial').length,3);
  for(const row of names){
   await db.query('insert into public.playback_logs(device_id,client_event_id,media_id,started_at,ended_at,completed) values($1,$2,$3,$4,$5,$6) on conflict(device_id,client_event_id) do nothing',
    [id(20),row.client_event_id,row.media_id,row.started_at.toISOString(),row.ended_at.toISOString(),row.completed]);
  }
  await refreshCommercialDaily(admin,id(20),true);
  await refreshCommercialDaily(admin,id(20),true);
  const resultA=await portal(db,2),resultB=await portal(db,3);
  assert.equal(resultA.campaigns.length,1);
  assert.equal(resultB.campaigns.length,1);
  assert.equal(resultA.campaigns[0].id,a.id);
  assert.equal(resultB.campaigns[0].id,b.id);
  assert.equal(resultA.daily.length,1);
  assert.equal(resultB.daily.length,1);
  assert.equal(Number(resultA.daily[0].completed_count),1);
  assert.equal(Number(resultA.daily[0].attempt_count),2);
  assert.equal(Number(resultB.daily[0].completed_count),1);
  assert.equal(Number(resultB.daily[0].attempt_count),1);
  const masterReport=await commercialMaster(admin,{id:id(1)},'super_admin',{action:'commercial_report',id:id(40)});
  assert.equal(masterReport.ok,true);
  assert.equal(masterReport.campaigns.length,1);
  assert.equal(masterReport.campaigns[0].id,a.id);
  assert.equal(masterReport.daily[0].completed_count,1);
  const rows=await db.query('select storage_path from vision_commercial_revisions order by storage_path');
  assert.equal(rows.rows.length,2);
  assert.equal(rows.rows.every(x=>x.storage_path.startsWith('commercial-ads/')),true);
 }finally{await db.close();}
});
