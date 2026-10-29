-- ISOLATED DESIGN / DO NOT DEPLOY OR DELETE RAW DATA.
-- New v2 archive avoids reusing the previously backfilled local summary.
-- Event ledger deduplicates by immutable playback_logs.id; each transaction
-- inserts only new IDs and increments aggregate counters for those IDs.
-- IMPORTANT: this stage intentionally has NO DELETE, no scheduled job and
-- no public reporting grant. A verified restore and report v2 are prerequisites.
create table if not exists public.playback_archive_v2_events (
 log_id uuid primary key,
 company_id uuid not null,
 device_id uuid not null,
 play_date date not null,
 media_key text not null,
 completed boolean not null,
 duration_seconds numeric not null,
 started_at timestamptz not null,
 ingested_at timestamptz not null,
 archived_at timestamptz not null default now()
);
create index if not exists playback_archive_v2_events_company_day
 on public.playback_archive_v2_events(company_id,play_date,device_id);
create table if not exists public.playback_archive_v2_daily (
 play_date date not null,
 company_id uuid not null,
 device_id uuid not null,
 media_key text not null,
 started bigint not null default 0,
 completed bigint not null default 0,
 total_seconds numeric not null default 0,
 first_play timestamptz,
 last_play timestamptz,
 primary key(play_date,company_id,device_id,media_key)
);
alter table public.playback_archive_v2_events enable row level security;
alter table public.playback_archive_v2_daily enable row level security;
revoke all on public.playback_archive_v2_events from anon,authenticated;
revoke all on public.playback_archive_v2_daily from anon,authenticated;

-- Controlled one-batch archival, executed only by an authorized maintenance
-- role after a restore test. No SECURITY DEFINER, no exposed RPC.
-- The ledger and totals update in one transaction. Re-running the same
-- batch changes nothing; late-arriving event IDs are added exactly once.
-- Select a batch in a dedicated transaction, then use this statement:
with candidates as materialized (
 select l.id log_id,l.company_id,l.device_id,
 (l.started_at at time zone coalesce(c.timezone,'America/Sao_Paulo'))::date play_date,
 coalesce(l.media_id::text,'') media_key,
 l.completed,coalesce(l.duration_seconds,0)::numeric duration_seconds,
 l.started_at,l.created_at ingested_at
 from public.playback_logs l
 join public.companies c on c.id=l.company_id
 where l.campaign_id is null
   and l.started_at < now()-interval '32 days'
   and l.created_at < now()-interval '7 days'
 order by l.created_at,l.id
 limit 500
), newly_recorded as (
 insert into public.playback_archive_v2_events
 (log_id,company_id,device_id,play_date,media_key,completed,
  duration_seconds,started_at,ingested_at)
 select log_id,company_id,device_id,play_date,media_key,completed,
 duration_seconds,started_at,ingested_at from candidates
 on conflict(log_id) do nothing
 returning company_id,device_id,play_date,media_key,completed,
 duration_seconds,started_at
), grouped as (
 select play_date,company_id,device_id,media_key,
 count(*)::bigint started,count(*) filter(where completed)::bigint completed,
 sum(duration_seconds)::numeric total_seconds,
 min(started_at) first_play,max(started_at) last_play
 from newly_recorded group by 1,2,3,4
)
insert into public.playback_archive_v2_daily
 (play_date,company_id,device_id,media_key,started,completed,
 total_seconds,first_play,last_play)
select play_date,company_id,device_id,media_key,started,completed,
 total_seconds,first_play,last_play from grouped
on conflict(play_date,company_id,device_id,media_key)
do update set
 started=public.playback_archive_v2_daily.started+excluded.started,
 completed=public.playback_archive_v2_daily.completed+excluded.completed,
 total_seconds=public.playback_archive_v2_daily.total_seconds+excluded.total_seconds,
 first_play=least(public.playback_archive_v2_daily.first_play,excluded.first_play),
 last_play=greatest(public.playback_archive_v2_daily.last_play,excluded.last_play);
-- STOP: raw events must not be deleted by this script.
-- WARNING: ledger retention and exact idempotency must remain permanent or
-- otherwise be replaced by a formally verified safe watermark mechanism.
