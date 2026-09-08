alter table public.devices
  add column if not exists retired_at timestamptz,
  add column if not exists replaced_by_device_id uuid,
  add column if not exists replaces_device_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='devices_replaced_by_device_id_fkey') then
    alter table public.devices add constraint devices_replaced_by_device_id_fkey foreign key (replaced_by_device_id) references public.devices(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='devices_replaces_device_id_fkey') then
    alter table public.devices add constraint devices_replaces_device_id_fkey foreign key (replaces_device_id) references public.devices(id) on delete set null;
  end if;
end $$;

create index if not exists devices_company_active_idx on public.devices(company_id) where retired_at is null;
create index if not exists devices_replaced_by_idx on public.devices(replaced_by_device_id) where replaced_by_device_id is not null;
create index if not exists devices_replaces_idx on public.devices(replaces_device_id) where replaces_device_id is not null;

create or replace function private.enforce_device_plan_limit()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  max_allowed bigint;
  used_count bigint;
begin
  perform private.ensure_company_writable(new.company_id);
  max_allowed := private.company_limit_value(new.company_id, 'max_devices');
  if max_allowed is null then return new; end if;
  select count(*) into used_count from public.devices d where d.company_id = new.company_id and d.retired_at is null;
  if used_count >= max_allowed then raise exception 'plan_device_limit_reached' using errcode='P0001'; end if;
  return new;
end;
$$;

create or replace function public.replace_device_from_pairing(
  p_company_id uuid,
  p_old_device_id uuid,
  p_pairing_id uuid,
  p_claimed_by uuid,
  p_name text,
  p_orientation text default 'auto'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_old public.devices%rowtype;
  v_pair public.device_pairing_requests%rowtype;
  v_new public.devices%rowtype;
  v_now timestamptz := now();
  v_orientation text;
begin
  if p_company_id is null or p_old_device_id is null or p_pairing_id is null or p_claimed_by is null then raise exception 'invalid_replacement_input'; end if;
  if nullif(btrim(coalesce(p_name,'')),'') is null then raise exception 'device_name_required'; end if;
  v_orientation := case when p_orientation in ('auto','landscape','portrait') then p_orientation else 'auto' end;
  perform private.ensure_company_writable(p_company_id);
  if not private.company_license_allowed(p_company_id) then raise exception 'subscription_inactive'; end if;

  select * into v_old from public.devices where id=p_old_device_id and company_id=p_company_id for update;
  if not found then raise exception 'old_device_not_found'; end if;
  if v_old.retired_at is not null then raise exception 'old_device_already_replaced'; end if;

  select * into v_pair from public.device_pairing_requests where id=p_pairing_id for update;
  if not found then raise exception 'pairing_not_found'; end if;
  if v_pair.status <> 'pending' then raise exception 'pairing_not_pending'; end if;
  if v_pair.expires_at <= v_now then raise exception 'pairing_expired'; end if;
  if v_pair.setup_company_id is not null and v_pair.setup_company_id <> p_company_id then raise exception 'branded_player_company_mismatch'; end if;

  update public.devices set retired_at=v_now,status='disabled',updated_at=v_now where id=v_old.id;
  update public.device_credentials set revoked_at=coalesce(revoked_at,v_now) where device_id=v_old.id;

  insert into public.devices(company_id,name,platform,orientation,status,paired_at,settings,replaces_device_id)
  values(p_company_id,left(btrim(p_name),120),v_pair.platform,v_orientation,'offline',v_now,coalesce(v_old.settings,'{}'::jsonb)||jsonb_build_object('player','vision-web-v1'),v_old.id)
  returning * into v_new;

  update public.devices set replaced_by_device_id=v_new.id,updated_at=v_now where id=v_old.id;
  update public.device_playlist_assignments set device_id=v_new.id,updated_at=v_now where device_id=v_old.id and company_id=p_company_id;
  update public.campaign_devices set device_id=v_new.id where device_id=v_old.id and company_id=p_company_id;
  update public.device_pairing_requests set status='claimed',company_id=p_company_id,claimed_by=p_claimed_by,claimed_at=v_now,device_id=v_new.id where id=v_pair.id;

  return jsonb_build_object('ok',true,'old_device_id',v_old.id,'device',to_jsonb(v_new));
end;
$$;

revoke all on function public.replace_device_from_pairing(uuid,uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.replace_device_from_pairing(uuid,uuid,uuid,uuid,text,text) to service_role;
