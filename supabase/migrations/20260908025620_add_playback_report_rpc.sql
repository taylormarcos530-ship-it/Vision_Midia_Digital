create or replace function public.get_playback_report(
  p_company_id uuid, p_start_date date, p_end_date date,
  p_campaign_id uuid default null, p_device_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_timezone text; v_start timestamptz; v_end timestamptz; v_result jsonb;
begin
  if p_company_id is null or p_start_date is null or p_end_date is null then raise exception 'company and date range are required'; end if;
  if p_end_date < p_start_date then raise exception 'end date must be on or after start date'; end if;
  if (p_end_date - p_start_date) > 366 then raise exception 'report range cannot exceed 366 days'; end if;
  if not (select private.is_company_member(p_company_id)) then raise exception 'forbidden' using errcode='42501'; end if;
  select coalesce(c.timezone,'America/Sao_Paulo') into v_timezone from public.companies c where c.id=p_company_id;
  if v_timezone is null then raise exception 'company not found'; end if;
  v_start := (p_start_date::timestamp at time zone v_timezone);
  v_end := ((p_end_date + 1)::timestamp at time zone v_timezone);

  with filtered as materialized (
    select l.id,l.client_event_id,l.company_id,l.device_id,l.campaign_id,l.playlist_id,l.media_id,l.started_at,l.ended_at,l.duration_seconds,l.completed,
      coalesce(nullif(l.device_name,''),d.name,'TV removida') device_name,
      coalesce(nullif(l.campaign_name,''),c.name,case when l.campaign_id is null then 'Conteúdo padrão' else 'Campanha removida' end) campaign_name,
      coalesce(nullif(l.playlist_name,''),p.name,'Playlist removida') playlist_name,
      coalesce(nullif(l.media_name,''),m.name,'Mídia removida') media_name
    from public.playback_logs l
    left join public.devices d on d.id=l.device_id and d.company_id=l.company_id
    left join public.campaigns c on c.id=l.campaign_id and c.company_id=l.company_id
    left join public.playlists p on p.id=l.playlist_id and p.company_id=l.company_id
    left join public.media_assets m on m.id=l.media_id and m.company_id=l.company_id
    where l.company_id=p_company_id and l.started_at>=v_start and l.started_at<v_end
      and (p_campaign_id is null or l.campaign_id=p_campaign_id)
      and (p_device_id is null or l.device_id=p_device_id)
  ), summary as (
    select count(*)::bigint started,count(*) filter(where completed)::bigint completed,coalesce(sum(duration_seconds),0)::numeric total_seconds,
      count(distinct device_id)::bigint devices,count(distinct campaign_id) filter(where campaign_id is not null)::bigint campaigns,
      count(distinct media_id) filter(where media_id is not null)::bigint media,min(started_at) first_play,max(started_at) last_play from filtered
  ), campaign_rows as (
    select campaign_id,campaign_name,count(*)::bigint started,count(*) filter(where completed)::bigint completed,coalesce(sum(duration_seconds),0)::numeric total_seconds,
      count(distinct device_id)::bigint devices,count(distinct media_id) filter(where media_id is not null)::bigint media,min(started_at) first_play,max(started_at) last_play
    from filtered group by campaign_id,campaign_name
  ), device_rows as (
    select device_id,device_name,count(*)::bigint started,count(*) filter(where completed)::bigint completed,coalesce(sum(duration_seconds),0)::numeric total_seconds,
      count(distinct campaign_id) filter(where campaign_id is not null)::bigint campaigns,count(distinct media_id) filter(where media_id is not null)::bigint media,min(started_at) first_play,max(started_at) last_play
    from filtered group by device_id,device_name
  ), media_rows as (
    select media_id,media_name,count(*)::bigint started,count(*) filter(where completed)::bigint completed,coalesce(sum(duration_seconds),0)::numeric total_seconds,
      count(distinct device_id)::bigint devices,count(distinct campaign_id) filter(where campaign_id is not null)::bigint campaigns,min(started_at) first_play,max(started_at) last_play
    from filtered group by media_id,media_name
  ), recent_events as (select * from filtered order by started_at desc limit 250)
  select jsonb_build_object(
    'timezone',v_timezone,'start_date',p_start_date,'end_date',p_end_date,
    'summary',(select jsonb_build_object('started',s.started,'completed',s.completed,'completion_rate',case when s.started=0 then 0 else round((s.completed::numeric*100)/s.started,2) end,'total_seconds',s.total_seconds,'devices',s.devices,'campaigns',s.campaigns,'media',s.media,'first_play',s.first_play,'last_play',s.last_play) from summary s),
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object('campaign_id',r.campaign_id,'campaign_name',r.campaign_name,'started',r.started,'completed',r.completed,'completion_rate',case when r.started=0 then 0 else round((r.completed::numeric*100)/r.started,2) end,'total_seconds',r.total_seconds,'devices',r.devices,'media',r.media,'first_play',r.first_play,'last_play',r.last_play) order by r.started desc,r.campaign_name) from campaign_rows r),'[]'::jsonb),
    'devices',coalesce((select jsonb_agg(jsonb_build_object('device_id',r.device_id,'device_name',r.device_name,'started',r.started,'completed',r.completed,'completion_rate',case when r.started=0 then 0 else round((r.completed::numeric*100)/r.started,2) end,'total_seconds',r.total_seconds,'campaigns',r.campaigns,'media',r.media,'first_play',r.first_play,'last_play',r.last_play) order by r.started desc,r.device_name) from device_rows r),'[]'::jsonb),
    'media',coalesce((select jsonb_agg(jsonb_build_object('media_id',r.media_id,'media_name',r.media_name,'started',r.started,'completed',r.completed,'completion_rate',case when r.started=0 then 0 else round((r.completed::numeric*100)/r.started,2) end,'total_seconds',r.total_seconds,'devices',r.devices,'campaigns',r.campaigns,'first_play',r.first_play,'last_play',r.last_play) order by r.started desc,r.media_name) from media_rows r),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'client_event_id',e.client_event_id,'device_id',e.device_id,'device_name',e.device_name,'campaign_id',e.campaign_id,'campaign_name',e.campaign_name,'playlist_id',e.playlist_id,'playlist_name',e.playlist_name,'media_id',e.media_id,'media_name',e.media_name,'started_at',e.started_at,'ended_at',e.ended_at,'duration_seconds',e.duration_seconds,'completed',e.completed) order by e.started_at desc) from recent_events e),'[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;
revoke all on function public.get_playback_report(uuid,date,date,uuid,uuid) from public,anon;
grant execute on function public.get_playback_report(uuid,date,date,uuid,uuid) to authenticated;
