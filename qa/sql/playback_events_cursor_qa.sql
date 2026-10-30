-- QA ONLY. Do not deploy to production or grant public execution.
-- Separate keyset pagination function; existing get_playback_events remains unchanged.
-- Cursor = (started_at, id) of the last item on the previous page.
-- Both cursor values must be supplied together; first page uses both NULL.
create or replace function public.vision_playback_events_cursor_qa(
  p_company_id uuid,
  p_start_date date,
  p_end_date date,
  p_campaign_id uuid default null,
  p_device_id uuid default null,
  p_limit integer default 500,
  p_cursor_started_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid, client_event_id text, started_at timestamptz, ended_at timestamptz,
  duration_seconds numeric, completed boolean, device_id uuid, device_name text,
  campaign_id uuid, campaign_name text, playlist_id uuid, playlist_name text,
  media_id uuid, media_name text
)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_limit integer;
begin
  if p_company_id is null or p_start_date is null or p_end_date is null then
    raise exception 'company and date range are required';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end date must be on or after start date';
  end if;
  if (p_end_date - p_start_date) > 366 then
    raise exception 'report range cannot exceed 366 days';
  end if;
  if (p_cursor_started_at is null) <> (p_cursor_id is null) then
    raise exception 'cursor timestamp and id must be supplied together';
  end if;
  if not (select private.is_company_member(p_company_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(c.timezone,'America/Sao_Paulo') into v_timezone
    from public.companies c where c.id = p_company_id;
  if v_timezone is null then raise exception 'company not found'; end if;
  v_start := p_start_date::timestamp at time zone v_timezone;
  v_end := (p_end_date + 1)::timestamp at time zone v_timezone;
  v_limit := greatest(1,least(coalesce(p_limit,500),1000));
  return query
    select l.id,l.client_event_id,l.started_at,l.ended_at,l.duration_seconds,l.completed,
      l.device_id,coalesce(nullif(l.device_name,''),d.name,'TV removida'),
      l.campaign_id,coalesce(nullif(l.campaign_name,''),c.name,
        case when l.campaign_id is null then 'Conteúdo padrão' else 'Campanha removida' end),
      l.playlist_id,coalesce(nullif(l.playlist_name,''),p.name,'Playlist removida'),
      l.media_id,coalesce(nullif(l.media_name,''),m.name,'Mídia removida')
    from public.playback_logs l
    left join public.devices d on d.id=l.device_id and d.company_id=l.company_id
    left join public.campaigns c on c.id=l.campaign_id and c.company_id=l.company_id
    left join public.playlists p on p.id=l.playlist_id and p.company_id=l.company_id
    left join public.media_assets m on m.id=l.media_id and m.company_id=l.company_id
    where l.company_id=p_company_id and l.started_at>=v_start and l.started_at<v_end
      and (p_campaign_id is null or l.campaign_id=p_campaign_id)
      and (p_device_id is null or l.device_id=p_device_id)
      and (p_cursor_started_at is null or (l.started_at,l.id)<(p_cursor_started_at,p_cursor_id))
    order by l.started_at desc,l.id desc limit v_limit;
end;
$$;
-- No GRANT statement: permissions must be reviewed in a dedicated QA environment.
-- For deployment safety, explicitly REVOKE inherited PUBLIC execute privileges
-- (PostgreSQL grants PUBLIC EXECUTE to newly created functions by default).
revoke all on function public.vision_playback_events_cursor_qa(uuid,date,date,uuid,uuid,integer,timestamptz,uuid) from public, anon, authenticated;
