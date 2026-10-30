-- ISOLATED READ-ONLY QA fixture: staging's old schema has no playback_logs.company_id.
-- This query creates NO tables, functions or records; synthetic data exists only within CTEs.
-- Do not treat the simulated membership predicate as a production authorization test.
with fixture_companies as (
  select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid company_id,
         '11111111-1111-4111-8111-111111111111'::uuid owner_user_id
  union all
  select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
         '22222222-2222-4222-8222-222222222222'::uuid
), fixture_devices as (
  select 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'::uuid device_id,
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid company_id
  union all
  select 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'::uuid,
         'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
), fixture_logs as (
  select ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid id,
         case when g <= 1200
           then 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'::uuid
           else 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'::uuid end device_id,
         '2026-10-28 12:00:00+00'::timestamptz - (g/3)*interval '1 second' started_at
  from generate_series(1,2400) g
), scoped as (
  select l.id,l.started_at,d.company_id
  from fixture_logs l join fixture_devices d on d.device_id=l.device_id
  join fixture_companies c on c.company_id=d.company_id
  where c.owner_user_id='11111111-1111-4111-8111-111111111111'::uuid
), page1 as (
  select id,started_at from scoped order by started_at desc,id desc limit 500
), edge as (
  select started_at,id from page1 order by started_at,id limit 1
), page2 as (
  select s.id from scoped s cross join edge e
  where (s.started_at,s.id)<(e.started_at,e.id)
  order by s.started_at desc,s.id desc limit 500
)
select (select count(*) from page1) page1_count,
       (select count(*) from page2) page2_count,
       (select count(*) from page1 join page2 using(id)) overlap,
       (select count(*) from scoped where company_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid) foreign_company_rows;
