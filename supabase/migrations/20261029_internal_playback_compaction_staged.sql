-- Vision: safe, manual, non-campaign retention maintenance.
-- This script is NOT deployed. Requires a verified encrypted backup first.
-- Does not alter campaign playback proofs.
-- Each transaction aggregates an entire UTC day before removing its internal logs.
-- Never execute until get_playback_report reads both raw and summary data.
create or replace function private.compact_internal_playback_day(p_day date)
returns table (summarized bigint, deleted bigint)
language plpgsql security definer set search_path = ''
as $$
declare v_count bigint; v_deleted bigint;
begin
  if p_day is null or p_day >= (now() at time zone 'UTC')::date - 33 then
    raise exception 'day is too recent; reserve 33 days for late offline uploads';
  end if;
  -- Prevent overlapping runs for the same date.
  perform pg_advisory_xact_lock(hashtext('vision_internal_playback'), hashtext(p_day::text));
  with source as (
    select company_id,device_id,coalesce(media_id::text,'') media_key,
      count(*) started,count(*) filter(where completed) completed,
      coalesce(sum(duration_seconds),0) total_seconds,
      min(started_at) first_play,max(started_at) last_play
    from public.playback_logs
    where campaign_id is null
      and started_at >= p_day::timestamp at time zone 'UTC'
      and started_at < (p_day+1)::timestamp at time zone 'UTC'
    group by company_id,device_id,media_id
  )
  insert into public.playback_daily_summary
    (play_date,company_id,device_id,campaign_key,media_key,started,completed,total_seconds,first_play,last_play)
  select p_day,company_id,device_id,'',media_key,started,completed,total_seconds,first_play,last_play
  from source
  on conflict (play_date,company_id,device_id,campaign_key,media_key)
  do update set started=excluded.started,completed=excluded.completed,
    total_seconds=excluded.total_seconds,first_play=excluded.first_play,last_play=excluded.last_play;
  select count(*) into v_count from public.playback_logs
    where campaign_id is null and started_at >= p_day::timestamp at time zone 'UTC'
      and started_at < (p_day+1)::timestamp at time zone 'UTC';
  -- A DELETE is deliberately NOT included. Confirm report compatibility and backup first.
  summarized := v_count; deleted := 0;
  return next;
end; $$;
revoke all on function private.compact_internal_playback_day(date) from public,anon,authenticated;
