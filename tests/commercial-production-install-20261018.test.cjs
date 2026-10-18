const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('production installer: PGlite schema, safe projections, Master and report isolation',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema private;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth,private to authenticated,service_role,anon;grant execute on function auth.uid() to authenticated,service_role;
 create table auth.users(id uuid primary key);
 create table public.platform_admins(user_id uuid,role text,status text);
 create table public.company_members(user_id uuid);
 create table public.companies(id uuid primary key,name text,owner_user_id uuid);
 create table public.devices(id uuid primary key,company_id uuid,name text,last_seen_at timestamptz,retired_at timestamptz);
 create table public.media_assets(id uuid primary key,name text,media_type text,storage_path text,source_url text,duration_seconds numeric,size_bytes bigint,checksum_sha256 text,width int,height int,processing_status text,updated_at timestamptz);
 create table public.playback_logs(id uuid primary key default gen_random_uuid(),device_id uuid,client_event_id text,media_id uuid,started_at timestamptz,ended_at timestamptz,completed boolean,created_at timestamptz default now(),unique(device_id,client_event_id));
 create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;grant usage on schema storage to authenticated;
 insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(4)}');
 insert into platform_admins values('${id(1)}','super_admin','active');insert into company_members values('${id(4)}');
 insert into companies values('${id(10)}','Auto Center');insert into devices values('${id(20)}','${id(10)}','TV Teste',now(),null);
 insert into media_assets values('${id(30)}','Oferta','image','media/test.webp',null,10,100,'sha',100,100,'ready',now());`);
 assert.ok(fs.existsSync('supabase/sql/advertiser-portal.sql'),'new schema must exist');
 await db.exec(fs.readFileSync('supabase/sql/vision-commercial-production-install-20261018.sql','utf8'));
 await db.exec(`insert into vision_advertisers(id,user_id,name,email) values('${id(40)}','${id(2)}','Loja A','a@example.test'),('${id(41)}','${id(3)}','Loja B','b@example.test');`);
 await assert.rejects(()=>db.exec(`insert into vision_advertisers(user_id,name,email) values('${id(4)}','Ponto','p@example.test')`),/separate_advertiser_account/);

 // An account created as an advertiser must never acquire client or Master privileges later.
 await assert.rejects(()=>db.exec(`insert into company_members(user_id) values('${id(2)}')`),/separate_advertiser_account/);
 await assert.rejects(()=>db.exec(`update company_members set user_id='${id(2)}' where user_id='${id(4)}'`),/separate_advertiser_account/);
 await assert.rejects(()=>db.exec(`insert into platform_admins(user_id,role,status) values('${id(2)}','admin','active')`),/separate_advertiser_account/);
 await assert.rejects(()=>db.exec(`update platform_admins set user_id='${id(2)}' where user_id='${id(1)}'`),/separate_advertiser_account/);
 await assert.rejects(()=>db.exec(`insert into companies(id,name,owner_user_id) values('${id(11)}','Outro ponto','${id(2)}')`),/separate_advertiser_account/);
 await assert.rejects(()=>db.exec(`update companies set owner_user_id='${id(2)}' where id='${id(10)}'`),/separate_advertiser_account/);
 // Existing non-advertiser identities still work in the operational tables.
 await db.exec(`insert into company_members(user_id) values('${id(1)}');update companies set owner_user_id='${id(4)}' where id='${id(10)}'`);

 let snapshotIndex=100;
 const save=async(advertiser,name,media=id(30),campaign=null)=>{
  // Simulate the isolated Master Storage copy; SQL itself must verify it exists.
  const commercial_copy_path='commercial-ads/'+id(++snapshotIndex)+'.webp';
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['vision-media',commercial_copy_path]);
  return (await db.query('select public.vision_commercial_save_campaign($1,$2::jsonb) as data',[id(1),JSON.stringify({id:campaign,advertiser_id:advertiser,name,media_id:media,start_date:'2026-01-01',end_date:'2027-12-31',device_ids:[id(20)],status:'active',commercial_copy_path})])).rows[0].data;
 };
 const a=await save(id(40),'Campanha A'),b=await save(id(41),'Campanha B');
 const rev=(await db.query('select id from vision_commercial_revisions where campaign_id=$1',[a.id])).rows[0].id;
 const revB=(await db.query('select id from vision_commercial_revisions where campaign_id=$1',[b.id])).rows[0].id;
 const isolated=(await db.query('select storage_path,source_storage_path from vision_commercial_revisions where id=$1',[rev])).rows[0];
 assert.match(isolated.storage_path,/^commercial-ads\//);
 assert.equal(isolated.source_storage_path,'media/test.webp');
 await assert.rejects(()=>db.query('select vision_commercial_save_campaign($1,$2::jsonb)',[id(1),JSON.stringify({advertiser_id:id(40),name:'No copy',media_id:id(30),start_date:'2026-01-01',end_date:'2027-12-31',device_ids:[id(20)],status:'active'})]),/commercial_snapshot_required/);

 await db.exec(`insert into playback_logs(device_id,client_event_id,media_id,started_at,ended_at,completed) values
 ('${id(20)}','real','${rev}',now()-interval '30 seconds',now()-interval '20 seconds',true),
 ('${id(20)}','failed','${rev}',now()-interval '20 seconds',now()-interval '19 seconds',false),
 ('${id(20)}','other','${revB}',now()-interval '20 seconds',now()-interval '10 seconds',true);
 update playback_logs set created_at=now()-interval '3 days';
 select vision_commercial_refresh_daily('${id(20)}');select vision_commercial_refresh_daily('${id(20)}');select vision_commercial_refresh_daily('${id(99)}');`);
 assert.equal(Number((await db.query('select sum(completed_count) as n from vision_commercial_daily where campaign_id=$1',[a.id])).rows[0].n),1,'idempotent totals, failed attempts excluded');
 const asUser=async(n,sql)=>{await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${id(n)}',false)`);try{return await db.query(sql)}finally{await db.exec('reset role')}};
 const portal=(await asUser(2,'select vision_advertiser_portal() as data')).rows[0].data;
 assert.equal(portal.campaigns.length,1);assert.equal(portal.campaigns[0].id,a.id);assert.equal(portal.daily.length,1);
 assert.equal(portal.revisions.length,1,'advertiser sees own revision');
 const visibleRevision=portal.revisions[0];
 for(const secret of ['source_storage_path','source_media_id','source_updated_at','checksum'])
  assert.equal(Object.hasOwn(visibleRevision,secret),false,'no internal source: '+secret);
 assert.equal(visibleRevision.storage_path.startsWith('commercial-ads/'),true);
 const permitted=(await asUser(2,'select id,name,storage_path from vision_commercial_revisions')).rows;
 assert.equal(permitted.length,1);
 await assert.rejects(()=>asUser(2,'select source_storage_path from vision_commercial_revisions'),/permission denied/);
 await assert.rejects(()=>asUser(2,'select source_media_id from vision_commercial_revisions'),/permission denied/);
 await assert.rejects(()=>asUser(2,'select checksum from vision_commercial_revisions'),/permission denied/);
 const customer=(await asUser(3,'select id,name,storage_path from vision_commercial_revisions')).rows;
 assert.equal(customer.length,1);
 assert.notEqual(customer[0].id,permitted[0].id,'cross-advertiser isolation');

 assert.equal((await asUser(2,'select * from vision_advertisers')).rows.length,1);
 assert.equal((await asUser(2,`select * from vision_commercial_campaigns where id='${b.id}'`)).rows.length,0);
 assert.equal((await asUser(4,'select * from vision_commercial_campaigns')).rows.length,0,'point owner sees no commercial controls/data');
 await assert.rejects(()=>asUser(2,`update vision_commercial_campaigns set name='hack'`),/permission denied/);
 await assert.rejects(()=>asUser(2,`select vision_commercial_save_campaign('${id(1)}','{}')`),/permission denied/);
 await assert.rejects(()=>asUser(2,`select vision_commercial_manifest('${id(20)}')`),/permission denied/);
 await db.exec(`insert into storage.objects values('vision-media','media/test.webp'),('vision-media','private/other.webp')`);
 assert.equal((await asUser(2,'select * from storage.objects')).rows.length,1);
 await db.exec(`update devices set last_seen_at=now()-interval '10 minutes'`);
 assert.equal((await asUser(2,'select vision_advertiser_portal() as data')).rows[0].data.targets[0].online,false);
 await db.exec(`update vision_advertisers set status='disabled' where id='${id(40)}'`);
 await assert.rejects(()=>asUser(2,'select vision_advertiser_portal()'),/advertiser_unavailable/);
 assert.equal((await asUser(2,'select * from vision_commercial_daily')).rows.length,0);
 assert.equal((await asUser(2,'select * from storage.objects')).rows.length,0);
 await db.exec(`update vision_advertisers set status='active' where id='${id(40)}';update media_assets set checksum_sha256='new'`);
 await save(id(40),'Campanha A',id(30),a.id);
 assert.equal((await db.query('select * from vision_commercial_revisions where campaign_id=$1',[a.id])).rows.length,2);
 const stored=await db.query('select storage_path from vision_commercial_revisions where campaign_id=$1',[a.id]);
 assert.notEqual(stored.rows[0].storage_path,stored.rows[1].storage_path,'media change must keep old and new independent snapshots');
 assert.equal((await db.query('select count(*)::int as n from storage.objects where name=$1',[isolated.storage_path])).rows[0].n,1,'original commercial revision remains available');

 assert.equal((await asUser(2,'select vision_advertiser_portal() as data')).rows[0].data.daily[0].completed_count,1,'media swap retains historical totals');

 // "Excluir" is a reversible archive: no Auth deletion, no Storage deletion, no log deletion.
 const beforeArchive=(await db.query(`select vision_commercial_manifest('${id(20)}') as ads`)).rows[0].ads;
 assert.ok(beforeArchive.some(x=>x.campaign_id===a.id),'active advertiser is eligible for future manifests');
 await db.exec(`update vision_advertisers set status='disabled',archived_at=now() where id='${id(40)}'`);
 await assert.rejects(()=>asUser(2,'select vision_advertiser_portal()'),/advertiser_unavailable/);
 const afterArchive=(await db.query(`select vision_commercial_manifest('${id(20)}') as ads`)).rows[0].ads;
 assert.equal(afterArchive.some(x=>x.campaign_id===a.id),false,'archived advertiser must not enter new manifests');
 assert.equal(Number((await db.query('select sum(completed_count) n from vision_commercial_daily where campaign_id=$1',[a.id])).rows[0].n),1,'archive preserves play history');
 assert.equal((await db.query('select count(*)::int n from vision_commercial_revisions where campaign_id=$1',[a.id])).rows[0].n,2,'archive keeps media revisions');
 assert.equal((await db.query('select count(*)::int n from storage.objects where name=$1',[isolated.storage_path])).rows[0].n,1,'archive keeps creative copy');
 await assert.rejects(()=>db.query('select vision_commercial_save_campaign($1,$2::jsonb)',[id(1),JSON.stringify({advertiser_id:id(40),name:'Should not save',media_id:id(30),start_date:'2026-01-01',end_date:'2027-12-31',device_ids:[id(20)],status:'active'})]),/advertiser_not_found/);
 await db.exec(`update vision_advertisers set archived_at=null,status='disabled' where id='${id(40)}'`);
 await assert.rejects(()=>asUser(2,'select vision_advertiser_portal()'),/advertiser_unavailable/);
 assert.equal((await db.query(`select vision_commercial_manifest('${id(20)}') as ads`)).rows[0].ads.some(x=>x.campaign_id===a.id),false,'restoring disabled does not resume commercials');

 await assert.rejects(()=>db.exec(`update vision_commercial_revisions set name='changed'`),/immutable_revision/);
 await db.exec('set role anon');await assert.rejects(()=>db.query('select vision_advertiser_portal()'),/permission denied/);await db.exec('reset role');
 }finally{await db.close()}
});
