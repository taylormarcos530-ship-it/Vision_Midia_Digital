-- Safe parallel report: combined totals only. The existing full report stays unchanged.
-- IMPORTANT: Archived UTC daily buckets are only included for complete UTC days
-- within the requested company's local date window, avoiding midnight overcount.
-- Archived rows still have raw counterparts; exclude them while raw rows exist.
create or replace function public.get_playback_combined_totals(
 p_company_id uuid,p_start_date date,p_end_date date,
 p_campaign_id uuid default null,p_device_id uuid default null
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare tz text; a timestamptz; z timestamptz; result jsonb;
begin
 if p_company_id is null or p_start_date is null or p_end_date is null
   or p_end_date < p_start_date or p_end_date-p_start_date > 366 then
   raise exception 'invalid report range';
 end if;
 if not (select private.is_company_member(p_company_id)) then
   raise exception 'forbidden' using errcode='42501';
 end if;
 select coalesce(timezone,'America/Sao_Paulo') into tz
 from public.companies where id=p_company_id;
 if tz is null then raise exception 'company not found'; end if;
 a:=p_start_date::timestamp at time zone tz;
 z:=(p_end_date+1)::timestamp at time zone tz;
 with raw as (
  select count(*)::bigint n,count(*) filter(where completed)::bigint done,
    coalesce(sum(duration_seconds),0)::numeric seconds
  from public.playback_logs
  where company_id=p_company_id and started_at>=a and started_at<z
    and (p_campaign_id is null or campaign_id=p_campaign_id)
    and (p_device_id is null or device_id=p_device_id)
 ), archived as (
  select coalesce(sum(s.started),0)::bigint n,
    coalesce(sum(s.completed),0)::bigint done,
    coalesce(sum(s.total_seconds),0)::numeric seconds
  from public.playback_daily_summary s
  where s.company_id=p_company_id
    and (s.play_date::timestamp at time zone 'UTC')>=a
    and ((s.play_date+1)::timestamp at time zone 'UTC')<=z
    and (p_campaign_id is null or s.campaign_key=p_campaign_id::text)
    and (p_device_id is null or s.device_id=p_device_id)
    -- No double counting while source rows are still present.
    and not exists (
      select 1 from public.playback_logs l
      where l.company_id=s.company_id and l.device_id=s.device_id
        and l.started_at >= (s.play_date::timestamp at time zone 'UTC')
        and l.started_at < ((s.play_date+1)::timestamp at time zone 'UTC')
        and coalesce(l.campaign_id::text,'')=s.campaign_key
        and coalesce(l.media_id::text,'')=s.media_key
    )
 )
 select jsonb_build_object('started',raw.n+archived.n,
  'completed',raw.done+archived.done,'total_seconds',raw.seconds+archived.seconds,
  'raw_started',raw.n,'archive_started',archived.n,'timezone',tz)
 into result from raw cross join archived;
 return result;
end; $$;
revoke all on function public.get_playback_combined_totals(uuid,date,date,uuid,uuid) from public,anon;
grant execute on function public.get_playback_combined_totals(uuid,date,date,uuid,uuid) to authenticated;
