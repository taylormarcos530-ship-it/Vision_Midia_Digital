-- SHADOW ONLY. No changes to get_playback_report or TV playback.
-- Archive is currently a copy of raw events, so never add both blindly.
-- This returns internal totals from raw events plus local archive groups ONLY
-- where the entire corresponding raw group is absent.
-- A partially deleted group is NOT supported; retention must be atomic by group.
create or replace function public.get_playback_internal_shadow_totals(
 p_company_id uuid,p_start_date date,p_end_date date,p_device_id uuid default null
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare tz text; output jsonb;
begin
 if p_company_id is null or p_start_date is null or p_end_date is null
 or p_end_date<p_start_date or p_end_date-p_start_date>366 then
  raise exception 'invalid range';
 end if;
 if not (select private.is_company_member(p_company_id)) then
  raise exception 'forbidden' using errcode='42501';
 end if;
 select coalesce(timezone,'America/Sao_Paulo') into tz
 from public.companies where id=p_company_id;
 if tz is null then raise exception 'company not found'; end if;
 with raw as materialized (
  select (l.started_at at time zone tz)::date as play_date,
   l.company_id,l.device_id,coalesce(l.media_id::text,'') media_key,
   count(*)::bigint started,
   count(*) filter(where l.completed)::bigint completed,
   coalesce(sum(l.duration_seconds),0)::numeric total_seconds
  from public.playback_logs l
  where l.company_id=p_company_id and l.campaign_id is null
   and l.started_at >= (p_start_date::timestamp at time zone tz)
   and l.started_at < ((p_end_date+1)::timestamp at time zone tz)
   and (p_device_id is null or l.device_id=p_device_id)
  group by 1,2,3,4
 ), archived as (
  select a.play_date,a.company_id,a.device_id,a.media_key,
   a.started,a.completed,a.total_seconds
  from public.playback_daily_summary_local a
  where a.company_id=p_company_id and a.campaign_key=''
   and a.play_date between p_start_date and p_end_date
   and (p_device_id is null or a.device_id=p_device_id)
   and not exists (
    select 1 from raw r where r.play_date=a.play_date
     and r.company_id=a.company_id and r.device_id=a.device_id
     and r.media_key=a.media_key
   )
 ), combined as (
  select started,completed,total_seconds from raw
  union all
  select started,completed,total_seconds from archived
 )
 select jsonb_build_object('started',coalesce(sum(started),0),
  'completed',coalesce(sum(completed),0),
  'total_seconds',coalesce(sum(total_seconds),0))
 into output from combined;
 return output;
end; $$;
revoke all on function public.get_playback_internal_shadow_totals(uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function public.get_playback_internal_shadow_totals(uuid,date,date,uuid) to authenticated;
-- IMPORTANT: Do not deploy this function as the official report.
-- No archive retention until ingestion watermark, idempotency and backup tests pass.
