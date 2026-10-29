-- Companion RPC for archived daily playback summaries.
-- Read-only; does not replace get_playback_report until UI integration is tested.
create or replace function public.get_playback_archive_summary(
 p_company_id uuid, p_start_date date, p_end_date date,
 p_campaign_id uuid default null, p_device_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare v_result jsonb;
begin
 if p_company_id is null or p_start_date is null or p_end_date is null
   or p_end_date < p_start_date or (p_end_date-p_start_date)>366 then
   raise exception 'invalid report date range';
 end if;
 if not (select private.is_company_member(p_company_id)) then
   raise exception 'forbidden' using errcode='42501';
 end if;
 select jsonb_build_object(
   'started',coalesce(sum(started),0),
   'completed',coalesce(sum(completed),0),
   'total_seconds',coalesce(sum(total_seconds),0),
   'first_play',min(first_play),
   'last_play',max(last_play),
   'groups',count(*)
 ) into v_result
 from public.playback_daily_summary
 where company_id=p_company_id
   and play_date between p_start_date and p_end_date
   and (p_campaign_id is null or campaign_key=p_campaign_id::text)
   and (p_device_id is null or device_id=p_device_id);
 return v_result;
end; $$;
revoke all on function public.get_playback_archive_summary(uuid,date,date,uuid,uuid) from public,anon,authenticated;
-- Grant only after establishing RLS policy for authenticated company members.
-- No changes to current report or deletion behavior in this migration.
