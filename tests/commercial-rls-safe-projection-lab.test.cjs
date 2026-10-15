// OFFLINE LAB ONLY: test prospective safe projection on fresh in-memory PGlite.
// Does not alter source SQL, remote Supabase, player, APK or operational gateway.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const users={master:1,a:2,b:3,point:4,outsider:5};
const privateMedia='private-owner/customer-original.webp';
const safeFields=['campaign_id','created_at','duration_seconds','height','id',
 'media_type','name','size_bytes','storage_path','width'];

test('local PostgreSQL: safe advertiser projection and column permissions',async t=>{
 const db=new PGlite(),original=fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8'),
  patch=fs.readFileSync('tests/fixtures/commercial-safe-projection-lab.sql','utf8');
 const copies=['commercial-ads/'+id(301)+'.webp','commercial-ads/'+id(302)+'.webp'];
 const campaigns=[];
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
 const denied=(n,sql,pattern=/permission denied/)=>asUser(n,
  ()=>assert.rejects(()=>db.query(sql),pattern));
 const portal=async n=>(await queryAs(n,'SELECT vision_advertiser_portal() AS result')).rows[0].result;
 try{
  const setup=[
   'CREATE ROLE anon','CREATE ROLE authenticated','CREATE ROLE service_role BYPASSRLS',
   'CREATE SCHEMA auth','CREATE SCHEMA private','CREATE SCHEMA storage',
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$",
   'GRANT USAGE ON SCHEMA public,auth,private TO authenticated,service_role,anon',
   'GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role',
   'CREATE TABLE auth.users(id uuid PRIMARY KEY)',
   'CREATE TABLE public.platform_admins(user_id uuid,role text,status text)',
   'CREATE TABLE public.company_members(user_id uuid)',
   'CREATE TABLE public.companies(id uuid PRIMARY KEY,name text,owner_user_id uuid)',
   'CREATE TABLE public.devices(id uuid PRIMARY KEY,company_id uuid,name text,last_seen_at timestamptz,retired_at timestamptz)',
   'CREATE TABLE public.media_assets(id uuid PRIMARY KEY,name text,media_type text,storage_path text,source_url text,duration_seconds numeric,size_bytes bigint,checksum_sha256 text,width int,height int,processing_status text,updated_at timestamptz)',
   'CREATE TABLE public.playback_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),device_id uuid,client_event_id text,media_id uuid,started_at timestamptz,ended_at timestamptz,completed boolean,created_at timestamptz DEFAULT now(),UNIQUE(device_id,client_event_id))',
   'CREATE TABLE storage.objects(bucket_id text,name text)',
   'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY',
   'GRANT USAGE ON SCHEMA storage TO authenticated',
   'GRANT SELECT ON storage.objects TO authenticated'
  ];
  await db.exec(setup.join(';')+';');
  for(const n of Object.values(users))await db.query('INSERT INTO auth.users VALUES($1)',[id(n)]);
  await db.query("INSERT INTO platform_admins VALUES($1,'super_admin','active')",[id(users.master)]);
  await db.query('INSERT INTO company_members VALUES($1)',[id(users.point)]);
  await db.query('INSERT INTO companies VALUES($1,$2,$3)',[id(10),'Oficina de teste',id(users.point)]);
  await db.query('INSERT INTO devices VALUES($1,$2,$3,now(),NULL)',[id(20),id(10),'TV fictícia']);
  await db.query('INSERT INTO media_assets VALUES($1,$2,$3,$4,NULL,10,100,$5,1920,1080,$6,now())',
   [id(30),'Peça do ponto','image',privateMedia,'hash-original','ready']);
  await db.exec(original);
  await db.query('INSERT INTO vision_advertisers(id,user_id,name,email) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
   [id(40),id(users.a),'Anunciante A','a@example.test',
    id(41),id(users.b),'Anunciante B','b@example.test']);
  for(const [index,advertiser] of [40,41].entries()){
   await db.query('INSERT INTO storage.objects VALUES($1,$2)',['vision-media',copies[index]]);
   const params={advertiser_id:id(advertiser),name:'Campanha '+(index+1),
    media_id:id(30),start_date:'2026-01-01',end_date:'2027-12-31',
    device_ids:[id(20)],status:'active',commercial_copy_path:copies[index]};
   const result=(await db.query('SELECT vision_commercial_save_campaign($1,$2::jsonb) AS payload',
    [id(users.master),JSON.stringify(params)])).rows[0].payload;
   campaigns.push(result.id);
  }
  await t.test('negative control establishes both original exposures before local patch',async()=>{
   const originalPortal=await portal(users.a);
   assert.equal(originalPortal.revisions[0].source_storage_path,privateMedia);
   assert.equal(originalPortal.revisions[0].source_media_id,id(30));
   const raw=(await queryAs(users.a,
    'SELECT source_media_id,source_storage_path FROM vision_commercial_revisions')).rows;
   assert.equal(raw.length,1);
   assert.equal(raw[0].source_storage_path,privateMedia);
  });
  await db.exec(patch); // Apply ONLY to this disposable PGlite database.

  await t.test('direct SELECT denies private source paths, media IDs, timestamps and hashes',async()=>{
   for(const field of ['source_storage_path','source_media_id','source_updated_at','checksum']){
    const result=(await db.query('SELECT has_column_privilege($1,$2,$3,$4) AS allowed',
     ['authenticated','public.vision_commercial_revisions',field,'SELECT'])).rows[0];
    assert.equal(result.allowed,false,'column '+field+' still selectable');
    await denied(users.a,'SELECT '+field+' FROM public.vision_commercial_revisions');
    await denied(users.b,'SELECT '+field+' FROM public.vision_commercial_revisions');
   }
   await denied(users.a,'SELECT * FROM public.vision_commercial_revisions');
   const rows=(await queryAs(users.a,
    'SELECT id,campaign_id,name,media_type,storage_path,duration_seconds FROM vision_commercial_revisions')).rows;
   assert.equal(rows.length,1);
   assert.equal(rows[0].campaign_id,campaigns[0]);
   assert.equal(rows[0].storage_path,copies[0]);
  });
  await t.test('portal RPC uses allowlisted revision fields only',async()=>{
   const data=await portal(users.a);
   assert.equal(data.revisions.length,1);
   assert.deepEqual(Object.keys(data.revisions[0]).sort(),safeFields);
   const response=JSON.stringify(data);
   for(const x of ['source_storage_path','source_media_id','source_updated_at',
    'checksum',privateMedia,id(30)])
    assert.equal(response.includes(x),false,'sensitive metadata exposed: '+x);
   assert.equal(data.revisions[0].storage_path,copies[0]);
   assert.equal(data.campaigns.length,1);
   assert.equal(data.targets.length,1);
   assert.deepEqual(data.daily,[]);
  });
  await t.test('advertiser B cannot access advertiser A fields, revision or copy',async()=>{
   const a=await portal(users.a),b=await portal(users.b);
   assert.equal(b.campaigns.length,1);
   assert.equal(b.campaigns[0].id,campaigns[1]);
   assert.equal(b.revisions[0].storage_path,copies[1]);
   assert.equal(JSON.stringify(b).includes(copies[0]),false);
   assert.equal(JSON.stringify(a).includes(copies[1]),false);
   assert.deepEqual((await queryAs(users.a,
    'SELECT id FROM vision_commercial_revisions WHERE campaign_id=$1',[campaigns[1]])).rows,[]);
  });
  await t.test('Storage RLS still permits only each commercial copy, not original owner media',async()=>{
   await db.query('INSERT INTO storage.objects VALUES($1,$2)',['vision-media',privateMedia]);
   for(const [actor,index] of [[users.a,0],[users.b,1]]){
    const files=(await queryAs(actor,'SELECT name FROM storage.objects ORDER BY name')).rows.map(x=>x.name);
    assert.deepEqual(files,[copies[index]]);
   }
   assert.deepEqual((await queryAs(users.point,'SELECT name FROM storage.objects')).rows,[]);
  });
  await t.test('Master-only reporting and writes remain permission restricted',async()=>{
   await denied(users.a,"UPDATE vision_commercial_revisions SET name='modified'");
   await denied(users.a,"SELECT vision_commercial_master_report('"+id(users.master)+"','"+id(40)+"')");
   const master=(await db.query('SELECT vision_commercial_master_report($1,$2) AS result',
    [id(users.master),id(40)])).rows[0].result;
   assert.deepEqual(Object.keys(master.revisions[0]).sort(),safeFields);
   assert.equal(JSON.stringify(master).includes(privateMedia),false);
   await assert.rejects(()=>db.query('SELECT vision_commercial_master_report($1,$2)',
    [id(users.point),id(40)]),/master_forbidden/);
  });
  await t.test('establishment, unrelated and anonymous identities cannot access revisions',async()=>{
   for(const user of [users.point,users.outsider,users.master]){
    assert.deepEqual((await queryAs(user,'SELECT id,name FROM vision_commercial_revisions')).rows,[]);
    await asUser(user,()=>assert.rejects(
     ()=>db.query('SELECT vision_advertiser_portal()'),/advertiser_unavailable/));
   }
   await db.exec('SET ROLE anon');
   try{
    await assert.rejects(()=>db.query('SELECT id FROM vision_commercial_revisions'),/permission denied/);
    await assert.rejects(()=>db.query('SELECT vision_advertiser_portal()'),/permission denied/);
   }finally{await db.exec('RESET ROLE')}
  });
  await t.test('archiving one advertiser revokes access without modifying customer media',async()=>{
   await db.query("UPDATE vision_advertisers SET status='disabled',archived_at=now() WHERE id=$1",[id(40)]);
   await asUser(users.a,()=>assert.rejects(
    ()=>db.query('SELECT vision_advertiser_portal()'),/advertiser_unavailable/));
   assert.deepEqual((await queryAs(users.a,'SELECT id FROM vision_commercial_revisions')).rows,[]);
   assert.deepEqual((await queryAs(users.a,'SELECT name FROM storage.objects')).rows,[]);
   assert.equal((await portal(users.b)).revisions.length,1);
   assert.equal((await db.query('SELECT storage_path FROM media_assets WHERE id=$1',[id(30)])).rows[0].storage_path,privateMedia);
  });
  await t.test('fix is test-only and never mutates the original SQL or production gateway',()=>{
   assert.equal(fs.readFileSync('supabase/sql/advertiser-portal.sql','utf8'),original);
   assert.match(patch,/LAB FIXTURE ONLY/);
   assert.match(patch,/REVOKE SELECT ON TABLE public\.vision_commercial_revisions/);
   assert.match(patch,/CREATE OR REPLACE FUNCTION private\.vision_portal_data/);
   assert.doesNotMatch(patch,/\b(?:DROP TABLE|TRUNCATE TABLE|DELETE FROM)\b/i);
   assert.doesNotMatch(fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8'),
    /commercial-safe-projection-lab/);
  });
 }finally{await db.close()}
});
