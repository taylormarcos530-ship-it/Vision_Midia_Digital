const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('public point location is consent-gated and advertiser scoped in commercial portal',async()=>{
 const db=new PGlite();
 try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;create schema storage;"+
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
 "grant usage on schema public,auth,private to authenticated,service_role,anon;"+
 "grant execute on function auth.uid() to authenticated,service_role;"+
 "create table auth.users(id uuid primary key);"+
 "create table public.platform_admins(user_id uuid,role text,status text);"+
 "create table public.company_members(user_id uuid);"+
 "create table public.companies(id uuid primary key,name text,owner_user_id uuid);"+
 "create table public.devices(id uuid primary key,company_id uuid,name text,last_seen_at timestamptz,retired_at timestamptz,current_media_id uuid);"+
 "create table public.media_assets(id uuid primary key,name text,media_type text,storage_path text,source_url text,duration_seconds numeric,size_bytes bigint,checksum_sha256 text,width int,height int,processing_status text,updated_at timestamptz);"+
 "create table public.playback_logs(id uuid primary key default gen_random_uuid(),device_id uuid,client_event_id text,media_id uuid,started_at timestamptz,ended_at timestamptz,completed boolean,created_at timestamptz default now(),unique(device_id,client_event_id));"+
 "create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;");
 await db.exec("insert into auth.users values('"+id(1)+"'),('"+id(2)+"'),('"+id(3)+"');"+
 "insert into public.platform_admins values('"+id(1)+"','super_admin','active');"+
 "insert into public.companies values('"+id(10)+"','Life','"+id(1)+"');"+
 "insert into public.devices values('"+id(20)+"','"+id(10)+"','Teste casa',now(),null,null),('"+id(21)+"','"+id(10)+"','Life fundo',now(),null,null);");
 await db.exec(fs.readFileSync('supabase/sql/vision-commercial-production-install-20261018.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/sql/vision-commercial-point-transparency-20261018.sql','utf8'));
 await db.exec("insert into vision_advertisers(id,user_id,name,email) values('"+id(40)+"','"+id(2)+"','Teste','a@example.test'),('"+id(41)+"','"+id(3)+"','Outro','b@example.test');"+
 "insert into vision_commercial_campaigns(id,advertiser_id,name,start_date,end_date,status) values('"+id(50)+"','"+id(40)+"','Campanha',current_date,current_date+1,'active');"+
 "insert into vision_commercial_targets(campaign_id,device_id,point_name,device_name) values('"+id(50)+"','"+id(20)+"','Life','Teste casa'),('"+id(50)+"','"+id(21)+"','Life','Life fundo');");
 await db.exec("insert into vision_commercial_point_profile(device_id,public_label,public_address,neighborhood,city) values('"+id(20)+"','Casa PRIVADA','Endereço pessoal oculto','Centro','Anápolis'),('"+id(21)+"','Academia Life','Rua Comercial 123','Bairro Comercial','Anápolis');");
 const portal=async actor=>{
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(actor)]);
  try {return (await db.query('select public.vision_advertiser_portal() data')).rows[0]?.data;} finally {await db.exec('reset role');}
 };
 let a=await portal(2);
 assert.equal(a.targets.length,2);
 assert.equal(a.targets.every(t=>t.public_location===null),true);
 assert.equal(a.targets.every(t=>t.commercial_on_screen===false),true);
 await assert.rejects(()=>db.exec("update vision_commercial_point_profile set share_location=true where device_id='"+id(20)+"'"),/location_requires_consent/);
 await db.exec("update vision_commercial_point_profile set share_location=true,consent_confirmed_at=now(),consent_confirmed_by='"+id(1)+"' where device_id='"+id(21)+"'");
 await db.exec("update vision_commercial_campaigns set current_revision_id=null where id='"+id(50)+"'");
 a=await portal(2);
 const home=a.targets.find(t=>t.device_id===id(20)),office=a.targets.find(t=>t.device_id===id(21));
 assert.equal(home.public_location,null);
 assert.equal(office.public_location.city,'Anápolis');
 assert.equal(office.public_location.address,'Rua Comercial 123');
 await db.exec("set role authenticated;select set_config('request.jwt.claim.sub','"+id(2)+"',false)");
 await assert.rejects(()=>db.exec('select * from vision_commercial_point_profile'),/permission denied/);
 await db.exec('reset role');
 const b=await portal(3);
 assert.equal(b.targets.length,0);
 // Archiving removes a campaign from advertiser views and disables every linked TV.
 await db.exec(fs.readFileSync('supabase/sql/vision-commercial-campaign-archive-20261018.sql','utf8'));
 await assert.rejects(()=>db.query('select public.vision_commercial_archive_campaign($1,$2)',[id(2),id(50)]),/master_forbidden/);
 const archived=(await db.query('select public.vision_commercial_archive_campaign($1,$2) x',[id(1),id(50)])).rows[0].x;
 assert.equal(archived.archived,true);
 assert.equal((await db.query('select status from vision_commercial_campaigns where id=$1',[id(50)])).rows[0].status,'paused');
 assert.equal((await db.query('select count(*)::int n from vision_commercial_targets where campaign_id=$1 and active',[id(50)])).rows[0].n,0);
 const hidden=await portal(2);
 await db.exec('set role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(2)]);
 try{
  assert.equal((await db.query('select id from vision_commercial_campaigns')).rows.length,0);
  assert.equal((await db.query('select device_id from vision_commercial_targets')).rows.length,0);
 }finally{await db.exec('reset role');}
 assert.equal(hidden.campaigns.length,0);
 assert.equal(hidden.revisions.length,0);
 assert.equal(hidden.targets.length,0);
 await assert.rejects(()=>db.exec("update vision_commercial_campaigns set status='active' where id='"+id(50)+"'"),/archived_campaign_locked/);
 const restored=(await db.query('select public.vision_commercial_restore_campaign($1,$2) x',[id(1),id(50)])).rows[0].x;
 assert.equal(restored.status,'draft');
 assert.equal((await db.query('select status from vision_commercial_campaigns where id=$1',[id(50)])).rows[0].status,'draft');
 assert.equal((await db.query('select count(*)::int n from vision_commercial_targets where campaign_id=$1 and active',[id(50)])).rows[0].n,0);
 assert.equal((await portal(2)).campaigns.length,1);
 }finally{await db.close();}
});

test('campaign archive migration has valid PostgreSQL quoted triggers and portal visibility guard',()=>{
 const sql=fs.readFileSync('supabase/sql/vision-commercial-campaign-archive-20261018.sql','utf8');
 assert.match(sql,/returns trigger language plpgsql set search_path='' as \${2}/);
 assert.match(sql,/archived_campaign_locked/);
 assert.match(sql,/vision_commercial_archive_campaign/);
 assert.match(sql,/vision_commercial_restore_campaign/);
 assert.equal((sql.match(/c\.archived_at IS NULL/g)||[]).length,4);
});
