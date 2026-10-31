-- Vision V2 / F1: RPC de bancada SOMENTE no projeto yuwvgpvwgeowhgtxssvr.
-- Não copiar para produção; sem cron, sem exclusão de dados, sem TV real.
create table if not exists vision_v2_qa.device_tokens (
  device_id uuid primary key references vision_v2_qa.devices(id) on delete restrict,
  token_sha256 bytea not null unique check (octet_length(token_sha256) = 32),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table vision_v2_qa.device_tokens enable row level security;
revoke all on vision_v2_qa.device_tokens from public, anon, authenticated;

-- A única função exposta neste protótipo é uma RPC restrita a service_role.
-- A Edge Function exige token de TV e NUNCA repassa credenciais de servidor.
create or replace function public.vision_v2_qa_device_api(
  p_token text,
  p_action text,
  p_known_revision bigint default null,
  p_events jsonb default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $f$
declare
  v_device uuid;
  v_company uuid;
  v_revision bigint;
  v_timezone text;
  v_manifest jsonb;
  v_event jsonb;
  v_event_id text;
  v_media uuid;
  v_played timestamptz;
  v_completed boolean;
  v_seconds numeric;
  v_hash bytea;
  v_new bytea;
  v_accepted integer := 0;
  v_duplicate integer := 0;
  v_date date;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok',false,'error','unauthorized');
  end if;

  select d.id,d.company_id,d.manifest_revision,c.timezone
  into v_device,v_company,v_revision,v_timezone
  from vision_v2_qa.device_tokens t
  join vision_v2_qa.devices d on d.id=t.device_id
  join vision_v2_qa.companies c on c.id=d.company_id
  where t.token_sha256=extensions.digest(pg_catalog.convert_to(p_token,'UTF8'),'sha256')
    and t.revoked_at is null;

  if not found then
    return jsonb_build_object('ok',false,'error','unauthorized');
  end if;

  if p_action='sync' then
    if v_revision=0 then
      return jsonb_build_object('ok',true,'action','sync','configured',false,
          'changed',false,'revision',0,'server_time',pg_catalog.now());
    end if;
    if p_known_revision is not null and p_known_revision=v_revision then
      return jsonb_build_object('ok',true,'action','sync','configured',true,
          'changed',false,'revision',v_revision,'server_time',pg_catalog.now());
    end if;
    select mr.manifest into v_manifest from vision_v2_qa.manifest_revisions mr
      where mr.device_id=v_device and mr.revision=v_revision;
    if not found then
      return jsonb_build_object('ok',false,'error','manifest_unavailable');
    end if;
    return jsonb_build_object('ok',true,'action','sync','configured',true,
        'changed',true,'revision',v_revision,'manifest',v_manifest,
        'server_time',pg_catalog.now());
  elsif p_action='playback_batch' then
    if p_events is null or pg_catalog.jsonb_typeof(p_events)<>'array'
      or pg_catalog.jsonb_array_length(p_events) not between 1 and 50 then
      return jsonb_build_object('ok',false,'error','invalid_batch');
    end if;
    for v_event in select value from pg_catalog.jsonb_array_elements(p_events)
    loop
      if pg_catalog.jsonb_typeof(v_event)<>'object'
        or pg_catalog.jsonb_typeof(v_event->'event_id')<>'string'
        or pg_catalog.jsonb_typeof(v_event->'media_id')<>'string'
        or pg_catalog.jsonb_typeof(v_event->'played_at')<>'string'
        or pg_catalog.jsonb_typeof(v_event->'completed')<>'boolean'
        or pg_catalog.jsonb_typeof(v_event->'duration_seconds')<>'number'
      then
        raise exception using errcode='22023', message='invalid_playback_event';
      end if;
      v_event_id := v_event->>'event_id';
      if length(v_event_id) not between 8 and 128 or v_event_id !~ '^[A-Za-z0-9_-]+$'
        or (v_event->>'media_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or (v_event->>'played_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      then
        raise exception using errcode='22023', message='invalid_playback_event';
      end if;
      v_media := (v_event->>'media_id')::uuid;
      v_played := (v_event->>'played_at')::timestamptz;
      v_completed := (v_event->>'completed')::boolean;
      v_seconds := (v_event->>'duration_seconds')::numeric;
      if v_seconds < 0 or v_seconds > 3600 or v_seconds is null
        or v_played > pg_catalog.now()+ interval '5 minutes'
        or v_played < pg_catalog.now()- interval '370 days' then
        raise exception using errcode='22023', message='invalid_playback_time_or_duration';
      end if;
      v_hash := extensions.digest(pg_catalog.convert_to(v_event_id,'UTF8'),'sha256');
      v_new := null;
      insert into vision_v2_qa.playback_event_keys(device_id,event_sha256)
      values(v_device,v_hash)
      on conflict do nothing
      returning event_sha256 into v_new;
      if v_new is null then
        v_duplicate := v_duplicate+1;
        continue;
      end if;

      insert into vision_v2_qa.playback_recent
         (company_id,device_id,media_id,event_sha256,played_at,completed,duration_seconds)
      values(v_company,v_device,v_media,v_hash,v_played,v_completed,v_seconds);
      v_date := (v_played at time zone v_timezone)::date;
      insert into vision_v2_qa.playback_daily
        (company_id,day,device_id,media_id,starts,completes,total_seconds,first_play,last_play)
      values(v_company,v_date,v_device,v_media,1,
        case when v_completed then 1 else 0 end,v_seconds,v_played,v_played)
      on conflict(company_id,day,device_id,media_id) do update set
        starts=vision_v2_qa.playback_daily.starts+1,
        completes=vision_v2_qa.playback_daily.completes+excluded.completes,
        total_seconds=vision_v2_qa.playback_daily.total_seconds+excluded.total_seconds,
        first_play=pg_catalog.least(vision_v2_qa.playback_daily.first_play,excluded.first_play),
        last_play=pg_catalog.greatest(vision_v2_qa.playback_daily.last_play,excluded.last_play);
      v_accepted := v_accepted+1;
    end loop;
    return jsonb_build_object('ok',true,'action','playback_batch',
      'accepted',v_accepted,'duplicates',v_duplicate,
      'received',v_accepted+v_duplicate);
  else
    return jsonb_build_object('ok',false,'error','unknown_action');
  end if;
end
$f$;

-- PostgreSQL concede EXECUTE a PUBLIC por padrão; bloquear explicitamente.
revoke all on function public.vision_v2_qa_device_api(text,text,bigint,jsonb)
  from public,anon,authenticated;
grant execute on function public.vision_v2_qa_device_api(text,text,bigint,jsonb)
  to service_role;
-- Sem regras permissivas de INSERT/SELECT para os clientes.
