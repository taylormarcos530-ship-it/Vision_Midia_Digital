-- Read-only QA checks for deterministic playback export ordering.
-- Run manually in a QA database; this file never modifies production.
-- A. Same 500-event page has 500 distinct IDs.
with chosen_company as (
  select company_id from public.playback_logs group by company_id order by count(*) desc limit 1
), page as (
  select l.id,l.started_at from public.playback_logs l join chosen_company c using(company_id)
  order by l.started_at desc,l.id desc limit 500
)
select count(*) as events,count(distinct id) as distinct_ids from page;

-- B. Adjacent pages are disjoint under a static snapshot.
with chosen_company as (
  select company_id from public.playback_logs group by company_id order by count(*) desc limit 1
), page1 as (
  select l.id from public.playback_logs l join chosen_company c using(company_id)
  order by l.started_at desc,l.id desc limit 500 offset 0
), page2 as (
  select l.id from public.playback_logs l join chosen_company c using(company_id)
  order by l.started_at desc,l.id desc limit 500 offset 500
)
select (select count(*) from page1) as page1_count,
       (select count(*) from page2) as page2_count,
       (select count(*) from page1 join page2 using(id)) as duplicate_ids;

-- C. Equal timestamps require a unique secondary key.
select count(*) as tied_company_timestamps from (
  select company_id,started_at from public.playback_logs
  group by company_id,started_at having count(*)>1
) ties;

-- D. Performance: compare the two queries in a dedicated QA database with
-- EXPLAIN (ANALYZE, BUFFERS). Avoid production EXPLAIN ANALYZE and write tests.
-- E. Concurrent inserts can shift OFFSET pages even with deterministic ordering.
-- A separate keyset/cursor strategy or snapshot is required to guarantee
-- no omissions during live ingestion. Do not claim this test covers that case.
