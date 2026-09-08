create or replace function public.get_playback_events(
  p_company_id uuid,p_start_date date,p_end_date date,p_campaign_id uuid default null,p_device_id uuid default null,p_limit integer default 500,p_offset integer default 0
) returns table(id uuid,client_event_id text,started_at timestamptz,ended_at timestamptz,duration_seconds numeric,completed boolean,device_id uuid,device_name text,campaign_id uuid,campaign_name text,playlist_id uuid,playlist_name text,media_id uuid,media_name text)
language plpgsql security invoker set search_path=''
as $$
declare v_timezone text; v_start timestamptz; v_end timestamptz; v_limit integer; v_offset integer;
begin
  if p_company_id is null or p_start_date is null or p_end_date is null then raise exception 'company and date range are required'; end if;
  if p_end_date<p_start_date then raise exception 'end date must be on or after start date'; end if;
  if (p_end_date-p_start_date)>366 then raise exception 'report range cannot exceed 366 days'; end if;
  if not (select private.is_company_member(p_company_id)) then raise exception 'forbidden' using errcode='42501'; end if;
  select coalesce(c.timezone,'America/Sao_Paulo') into v_timezone from public.companies c where c.id=p_company_id;
  if v_timezone is null then raise exception 'company not found'; end if;
  v_start := (p_start_date::timestamp at time zone v_timezone); v_end := ((p_end_date+1)::timestamp at time zone v_timezone);
  v_limit:=greatest(1,least(coalesce(p_limit,500),1000)); v_offset:=greatest(0,coalesce(p_offset,0));
  return query select l.id,l.client_event_id,l.started_at,l.ended_at,l.duration_seconds,l.completed,l.device_id,
    coalesce(nullif(l.device_name,''),d.name,'TV removida'),l.campaign_id,coalesce(nullif(l.campaign_name,''),c.name,case when l.campaign_id is null then 'Conteúdo padrão' else 'Campanha removida' end),
    l.playlist_id,coalesce(nullif(l.playlist_name,''),p.name,'Playlist removida'),l.media_id,coalesce(nullif(l.media_name,''),m.name,'Mídia removida')
  from public.playback_logs l
  left join public.devices d on d.id=l.device_id and d.company_id=l.company_id left join public.campaigns c on c.id=l.campaign_id and c.company_id=l.company_id
  left join public.playlists p on p.id=l.playlist_id and p.company_id=l.company_id left join public.media_assets m on m.id=l.media_id and m.company_id=l.company_id
  where l.company_id=p_company_id and l.started_at>=v_start and l.started_at<v_end and (p_campaign_id is null or l.campaign_id=p_campaign_id) and (p_device_id is null or l.device_id=p_device_id)
  order by l.started_at desc limit v_limit offset v_offset;
end; $$;
revoke all on function public.get_playback_events(uuid,date,date,uuid,uuid,integer,integer) from public,anon;
grant execute on function public.get_playback_events(uuid,date,date,uuid,uuid,integer,integer) to authenticated;
