// Offline RLS and API exposure audit on a fresh PGlite database.
// Uses the reviewable, NOT remotely applied SQL; never connects to Supabase.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const tables=['vision_advertisers','vision_commercial_campaigns',
 'vision_commercial_revisions','vision_commercial_targets','vision_commercial_daily'];
const users={master:1,a:2,b:3,point:4,outsider:5};
const names=Object.fromEntries(Object.entries(users).map(([k,n])=>[k,id(n)]));

test('offline PostgreSQL RLS matrix: separate advertiser, Master, point and anonymous roles',async t=>{
 const db=new PGlite();
 const source=fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8');
 let campaigns={};
 async function asUser(n,fn){
  await db.exec('SET ROLE authenticated');
  try{
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(n)]);
   return await fn();
  }finally{
   await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false)");
  }
 }
 const queryAs=(n,sql,params=[])=>asUser(n,()=>db.query(sql,params));
 const rejectedAs=(n,sql,pattern)=>asUser(n,()=>assert.rejects(()=>db.query(sql),pattern));
 const getCount=async (n,table)=>Number((await queryAs(n,
  'SELECT count(*)::int AS n FROM public.'+table)).rows[0].n);
 const getStorage=async(n)=> (await queryAs(n,"SELECT name FROM storage.objects ORDER BY name")).rows.map(x=>x.name);
 try{
  await db.exec(
   'CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;'+
   'CREATE SCHEMA auth;CREATE SCHEMA private;CREATE SCHEMA storage;'+
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
   'GRANT USAGE ON SCHEMA public,auth,private TO authenticated,service_role,anon;'+
   'GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;'+
   'CREATE TABLE auth.users(id uuid PRIMARY KEY);'+
   'CREATE TABLE public.platform_admins(user_id uuid,role text,status text);'+
   'CREATE TABLE public.company_members(user_id uuid);'+
   'CREATE TABLE public.companies(id uuid PRIMARY KEY,name text,owner_user_id uuid);'+
   'CREATE TABLE public.devices(id uuid PRIMARY KEY,company_id uuid,name text,last_seen_at timestamptz,retired_at timestamptz);'+
   'CREATE TABLE public.media_assets(id uuid PRIMARY KEY,name text,media_type text,storage_path text,source_url text,duration_seconds numeric,size_bytes bigint,checksum_sha256 text,width int,height int,processing_status text,updated_at timestamptz);'+
   'CREATE TABLE public.playback_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),device_id uuid,client_event_id text,media_id uuid,started_at timestamptz,ended_at timestamptz,completed boolean,created_at timestamptz DEFAULT now(), UNIQUE(device_id,client_event_id));'+
   'CREATE TABLE storage.objects(bucket_id text,name text);'+
   'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;'+
   'GRANT SELECT ON storage.objects TO authenticated;GRANT USAGE ON SCHEMA storage TO authenticated;'
  );
  for(const n of Object.values(users))await db.query('INSERT INTO auth.users VALUES($1)',[id(n)]);
  await db.query("INSERT INTO platform_admins VALUES($1,'super_admin','active')",[names.master]);
  await db.query('INSERT INTO company_members VALUES($1)',[names.point]);
  await db.query('INSERT INTO companies VALUES($1,$2,$3)',[id(10),'Oficina fictícia',names.point]);
  await db.query('INSERT INTO devices VALUES($1,$2,$3,now(),NULL)',[id(20),id(10),'TV laboratório']);
  await db.query('INSERT INTO media_assets VALUES($1,$2,$3,$4,NULL,10,100,$5,1920,1080,$6,now())',
   [id(30),'Oferta do ponto','image','private-owner/point-media.webp','sha-fixture','ready']);
  await db.exec(source);

  await db.query('INSERT INTO vision_advertisers(id,user_id,name,email) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
   [id(40),names.a,'Anunciante A','a@example.test',id(41),names.b,'Anunciante B','b@example.test']);
  let idx=100;
  async function makeCampaign(advertiser,name){
   const object='commercial-ads/'+id(idx++)+'.webp';
   await db.query('INSERT INTO storage.objects VALUES($1,$2)',['vision-media',object]);
   const payload={advertiser_id:id(advertiser),name,media_id:id(30),
    start_date:'2026-01-01',end_date:'2027-12-31',device_ids:[id(20)],
    status:'active',commercial_copy_path:object};
   const row=(await db.query('SELECT public.vision_commercial_save_campaign($1,$2::jsonb) AS data',
    [names.master,JSON.stringify(payload)])).rows[0].data;
   return {campaign:row.id,object};
  }
  campaigns.a=await makeCampaign(40,'Campanha A');
  campaigns.b=await makeCampaign(41,'Campanha B');
  const revs=(await db.query('SELECT id,campaign_id FROM vision_commercial_revisions')).rows;
  const revA=revs.find(x=>x.campaign_id===campaigns.a.campaign).id;
  const revB=revs.find(x=>x.campaign_id===campaigns.b.campaign).id;
  await db.query("INSERT INTO vision_commercial_daily(campaign_id,revision_id,device_id,day,attempt_count,completed_count) VALUES($1,$2,$5,current_date,2,1),($3,$4,$5,current_date,3,2)",
   [campaigns.a.campaign,revA,campaigns.b.campaign,revB,id(20)]);

  await t.test('RLS enabled on five commercial tables; anonymous has no grants',async()=>{
   const flags=(await db.query("SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (c.relname LIKE 'vision_commercial_%' OR c.relname='vision_advertisers')")).rows;
   assert.equal(flags.length,5);
   assert.ok(flags.every(x=>x.relrowsecurity===true));
   for(const table of tables){
    assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) AS ok',['anon','public.'+table,'SELECT'])).rows[0].ok,false,table);
    assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) AS ok',['authenticated','public.'+table,'UPDATE'])).rows[0].ok,false,table);
   }
  });
  await t.test('advertiser A sees only its own campaigns, revisions, targets and daily counters',async()=>{
   for(const table of tables)assert.equal(await getCount(users.a,table),1,table);
   const results=(await queryAs(users.a,'SELECT id FROM vision_commercial_campaigns')).rows;
   assert.equal(results[0].id,campaigns.a.campaign);
   assert.deepEqual(await getStorage(users.a),[campaigns.a.object]);
   assert.equal((await queryAs(users.a,'SELECT * FROM vision_commercial_campaigns WHERE id=$1',[campaigns.b.campaign])).rows.length,0);
   const portal=(await queryAs(users.a,'SELECT vision_advertiser_portal() AS payload')).rows[0].payload;
   assert.equal(portal.campaigns.length,1);
   assert.equal(portal.revisions.length,1);
   assert.equal(portal.targets.length,1);
   assert.equal(portal.daily.length,1);
   assert.equal(portal.campaigns[0].id,campaigns.a.campaign);
  });
  await t.test('advertiser B is isolated from A in RLS, Storage and portal',async()=>{
   for(const table of tables)assert.equal(await getCount(users.b,table),1,table);
   assert.deepEqual(await getStorage(users.b),[campaigns.b.object]);
   const portal=(await queryAs(users.b,'SELECT vision_advertiser_portal() AS payload')).rows[0].payload;
   assert.equal(portal.campaigns[0].id,campaigns.b.campaign);
   assert.equal(portal.daily[0].campaign_id,campaigns.b.campaign);
   assert.equal((await queryAs(users.b,'SELECT * FROM vision_commercial_revisions WHERE campaign_id=$1',[campaigns.a.campaign])).rows.length,0);
  });
  await t.test('establishment and unrelated accounts cannot read commercial data or snapshots',async()=>{
   for(const who of [users.point,users.outsider,users.master]){
    for(const table of tables)assert.equal(await getCount(who,table),0,'user '+who+' '+table);
    assert.deepEqual(await getStorage(who),[],'storage user '+who);
    await rejectedAs(who,'SELECT vision_advertiser_portal()',/advertiser_unavailable/);
   }
  });
  await t.test('advertiser cannot update commercial tables or call Master-only functions',async()=>{
   await rejectedAs(users.a,"UPDATE vision_commercial_campaigns SET name='spoof'",/permission denied/);
   await rejectedAs(users.a,"DELETE FROM vision_advertisers",/permission denied/);
   await rejectedAs(users.a,"INSERT INTO vision_commercial_daily(campaign_id,revision_id,device_id,day,attempt_count,completed_count) VALUES('"+campaigns.a.campaign+"','"+revA+"','"+id(20)+"',current_date,1000,1000)",/permission denied/);
   for(const name of [
    'vision_commercial_save_campaign', 'vision_commercial_manifest','vision_commercial_master_report',
    'vision_commercial_delivery','vision_commercial_event_labels'
   ]){
    const args={
     vision_commercial_save_campaign:"'"+names.master+"','{}'::jsonb",
     vision_commercial_manifest:"'"+id(20)+"'",
     vision_commercial_master_report:"'"+names.master+"','"+id(40)+"'",
     vision_commercial_delivery:"'"+id(20)+"','success'",
     vision_commercial_event_labels:"'"+id(20)+"',ARRAY[]::uuid[]"
    }[name];
    await rejectedAs(users.a,'SELECT '+name+'('+args+')',/permission denied/);
   }
  });
  await t.test('anonymous cannot open advertiser portal or query commercial tables',async()=>{
   await db.exec('SET ROLE anon');
   try{
    await assert.rejects(()=>db.query('SELECT * FROM vision_advertisers'),/permission denied/);
    await assert.rejects(()=>db.query('SELECT vision_advertiser_portal()'),/permission denied/);
   }finally{await db.exec('RESET ROLE')}
  });
  await t.test('Master operations require server-only service role and authorized actor',async()=>{
   await rejectedAs(users.master,"SELECT vision_commercial_master_report('"+names.master+"','"+id(40)+"')",/permission denied/);
   await assert.rejects(()=>db.query('SELECT vision_commercial_master_report($1,$2)',[names.point,id(40)]),/master_forbidden/);
   const result=(await db.query('SELECT vision_commercial_master_report($1,$2) AS payload',[names.master,id(40)])).rows[0].payload;
   assert.equal(result.campaigns.length,1);
   assert.equal(result.campaigns[0].id,campaigns.a.campaign);
  });
  await t.test('advertiser identity cannot be promoted to Master or company owner',async()=>{
   await assert.rejects(()=>db.query("INSERT INTO platform_admins VALUES($1,'admin','active')",[names.a]),/separate_advertiser_account/);
   await assert.rejects(()=>db.query('INSERT INTO company_members VALUES($1)',[names.b]),/separate_advertiser_account/);
   await assert.rejects(()=>db.query('UPDATE companies SET owner_user_id=$1 WHERE id=$2',[names.a,id(10)]),/separate_advertiser_account/);
   assert.equal((await db.query('SELECT owner_user_id FROM companies WHERE id=$1',[id(10)])).rows[0].owner_user_id,names.point);
  });
  await t.test('security finding: current portal exposes original point media source paths to advertiser',async()=>{
   const portal=(await queryAs(users.a,'SELECT vision_advertiser_portal() AS payload')).rows[0].payload;
   const snapshot=portal.revisions[0];
   const exposesSource=snapshot.source_storage_path==='private-owner/point-media.webp' &&
    snapshot.source_media_id===id(30);
   assert.equal(exposesSource,true,'document existing staging-only projection risk');
   // This is a FINDING, not an approval. Do not deploy the current projection to real advertisers.
   console.warn('SECURITY FINDING (staging-only): advertiser revision JSON includes point source_storage_path and source_media_id. Redact in reviewed future SQL/RPC contract.');
  });
  await t.test('archiving disables advertiser portal, RLS rows and its Storage view',async()=>{
   await db.query('UPDATE vision_advertisers SET status=$1,archived_at=now() WHERE id=$2',['disabled',id(40)]);
   for(const table of tables)assert.equal(await getCount(users.a,table),0,table);
   assert.deepEqual(await getStorage(users.a),[]);
   await rejectedAs(users.a,'SELECT vision_advertiser_portal()',/advertiser_unavailable/);
   assert.equal(await getCount(users.b,'vision_commercial_campaigns'),1);
   assert.equal(await getCount(users.b,'vision_commercial_daily'),1);
  });
 }finally{await db.close()}
});
