-- Read-only integration checks for vision_playback_events_cursor_qa.
-- Run in a dedicated QA Supabase project after installing the QA function and
-- explicitly granting EXECUTE only to the intended test role.
-- Do not run as production migrations.

-- 1. Authorization: using a test authenticated role that is NOT a member of
-- the selected company must fail with SQLSTATE 42501. A company member must
-- succeed. Also test anon, which must not have EXECUTE permission.
-- 2. Validation: date range >366 days, inverted dates, and half-null cursors
-- must fail. p_limit >1000 must return at most 1000 rows.
-- 3. Tenant isolation: company A's result must never contain company B's
-- events, including when p_device_id/p_campaign_id are set to B's IDs.
-- 4. Stable pagination: capture the last row's (started_at,id) as cursor,
-- then ensure page 2 contains no IDs from page 1 and preserves ordering.
-- 5. Live ingestion: insert new events into an ISOLATED QA fixture between
-- requests and confirm cursor-based continuation is unchanged.
-- 6. Compare each returned column and fallback name against the existing
-- get_playback_events RPC for the same company, filters and date range.

-- Static read-only baseline comparison (works without installing QA RPC):
with selected_company as (
  select company_id from public.playback_logs
  group by company_id order by count(*) desc limit 1
), first_page as (
  select l.id,l.started_at from public.playback_logs l
  join selected_company c using(company_id)
  order by l.started_at desc,l.id desc limit 500
), boundary as (
  select started_at,id from first_page
  order by started_at asc,id asc limit 1
), cursor_page as (
  select l.id from public.playback_logs l
  join selected_company c using(company_id)
  cross join boundary b
  where (l.started_at,l.id)<(b.started_at,b.id)
  order by l.started_at desc,l.id desc limit 500
), offset_page as (
  select l.id from public.playback_logs l
  join selected_company c using(company_id)
  order by l.started_at desc,l.id desc limit 500 offset 500
)
select (select count(*) from first_page) first_page_count,
       (select count(*) from cursor_page) cursor_page_count,
       (select count(*) from first_page join cursor_page using(id)) overlap,
       (select count(*) from cursor_page join offset_page using(id)) matching_second_page;
