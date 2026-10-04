// Run with @electric-sql/pglite available through NODE_PATH; no remote writes.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
(async () => {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create schema private; create schema storage;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth, private, storage to authenticated;
    create table public.platform_admins (user_id uuid, status text, role text);
    create table storage.objects (id serial, bucket_id text, name text);
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    grant select,insert,delete on storage.objects to authenticated;
    grant usage on sequence storage.objects_id_seq to authenticated;
    alter table storage.objects enable row level security;
    create policy company_read on storage.objects for select to authenticated using (bucket_id='vision-media' and (storage.foldername(name))[1]=auth.uid()::text);
    insert into storage.objects(bucket_id,name) values
      ('vision-media','11111111-1111-4111-8111-111111111111/image.webp'),
      ('vision-media','22222222-2222-4222-8222-222222222222/image.webp'),
      ('vision-media','_platform/branding.webp');
    insert into platform_admins values ('22222222-2222-4222-8222-222222222222','active','super_admin');
  `);
  const original = read('supabase/migrations/20260908033339_add_saas_master_core.sql');
  await db.exec(original.slice(original.indexOf('create or replace function private.is_platform_admin'), original.indexOf('create or replace function private.company_limit_value')));
  await db.exec('revoke all on function private.is_platform_admin(uuid) from public, anon, authenticated;');
  await db.exec(read('supabase/migrations/20261004095000_add_global_master_player_branding.sql'));
  await db.exec('grant select,insert,update on platform_player_branding to authenticated;');
  await db.exec("set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false)");
  await assert.rejects(db.query('select name from storage.objects'), /permission denied for function is_platform_admin/);
  console.log('REPRODUCED original storage signing SELECT permission failure');
  await db.exec('reset role');
  await db.exec(read('supabase/migrations/20261004144546_fix_player_branding_policy_helper.sql'));
  await db.exec('set role authenticated');
  let result = await db.query('select name from storage.objects');
  assert.deepEqual(result.rows.map(row => row.name), ['11111111-1111-4111-8111-111111111111/image.webp']);
  await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values ('vision-media','_platform/denied.webp')"), /row-level security/);
  await assert.rejects(db.query('select private.is_platform_admin()'), /permission denied/);
  console.log('PASS ordinary member reads own image; other company and Master storage remain denied');
  await db.exec("select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false)");
  result = await db.query('select name from storage.objects order by name');
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.some(row => row.name === '_platform/branding.webp'));
  assert.ok(!result.rows.some(row => row.name.startsWith('11111111')));
  await db.exec("insert into storage.objects(bucket_id,name) values ('vision-media','_platform/allowed.webp')");
  await db.exec("delete from storage.objects where name='_platform/allowed.webp'");
  await db.exec("insert into platform_player_branding(id,title) values (1,'Branding preserved'); update platform_player_branding set title='Master update' where id=1;");
  assert.equal((await db.query('select title from platform_player_branding')).rows[0].title, 'Master update');
  console.log('PASS Master branding read/write/delete remains authorized; company isolation preserved');
  await db.exec("select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false)");
  assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
  assert.equal((await db.query('select * from platform_player_branding')).rows.length, 0);
  console.log('PASS outsider has no media or Master branding access');
  await db.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
