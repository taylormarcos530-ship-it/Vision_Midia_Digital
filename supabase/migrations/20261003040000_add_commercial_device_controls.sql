-- Prepared only. Do not apply without explicit release authorization.
-- Commercial device controls: richer telemetry, fallback playlists and isolated TV groups.

alter table public.playlist_items
  add column if not exists is_essential boolean not null default false;

alter table public.companies
  add column if not exists fallback_playlist_id uuid references public.playlists(id) on delete set null;

alter table public.devices
  add column if not exists fallback_playlist_id uuid references public.playlists(id) on delete set null,
  add column if not exists player_version text,
  add column if not exists apk_version text,
  add column if not exists reported_orientation text;

create table if not exists public.device_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  playlist_id uuid references public.playlists(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id)
);

create table if not exists public.device_group_members (
  group_id uuid not null,
  device_id uuid not null,
  company_id uuid not null,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, device_id),
  unique (device_id),
  foreign key (group_id, company_id) references public.device_groups(id, company_id) on delete cascade,
  foreign key (device_id, company_id) references public.devices(id, company_id) on delete cascade
);

create index if not exists device_groups_company_idx
  on public.device_groups(company_id, updated_at desc);
create index if not exists device_group_members_company_group_idx
  on public.device_group_members(company_id, group_id);
create index if not exists device_group_members_company_device_idx
  on public.device_group_members(company_id, device_id);

create or replace function private.validate_commercial_playlist_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_playlist_id uuid;
  v_playlist_company_id uuid;
begin
  if tg_table_name = 'companies' then
    v_company_id := new.id;
    v_playlist_id := new.fallback_playlist_id;
  elsif tg_table_name = 'devices' then
    v_company_id := new.company_id;
    v_playlist_id := new.fallback_playlist_id;
  elsif tg_table_name = 'device_groups' then
    v_company_id := new.company_id;
    v_playlist_id := new.playlist_id;
  else
    return new;
  end if;

  if v_playlist_id is null then return new; end if;

  select p.company_id into v_playlist_company_id
  from public.playlists p
  where p.id = v_playlist_id;

  if v_playlist_company_id is null then
    raise exception 'playlist_not_found' using errcode = '23503';
  end if;
  if v_playlist_company_id <> v_company_id then
    raise exception 'playlist_company_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists companies_validate_fallback_playlist on public.companies;
create trigger companies_validate_fallback_playlist
before insert or update of fallback_playlist_id on public.companies
for each row execute function private.validate_commercial_playlist_company();

drop trigger if exists devices_validate_fallback_playlist on public.devices;
create trigger devices_validate_fallback_playlist
before insert or update of fallback_playlist_id on public.devices
for each row execute function private.validate_commercial_playlist_company();

drop trigger if exists device_groups_validate_playlist on public.device_groups;
create trigger device_groups_validate_playlist
before insert or update of playlist_id on public.device_groups
for each row execute function private.validate_commercial_playlist_company();

alter table public.device_groups enable row level security;
alter table public.device_group_members enable row level security;

drop policy if exists device_groups_select on public.device_groups;
create policy device_groups_select on public.device_groups
for select to authenticated
using ((select private.is_company_member(company_id)));

drop policy if exists device_groups_insert on public.device_groups;
create policy device_groups_insert on public.device_groups
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_company_role(company_id, array['owner','admin','operator']::text[]))
);

drop policy if exists device_groups_update on public.device_groups;
create policy device_groups_update on public.device_groups
for update to authenticated
using ((select private.has_company_role(company_id, array['owner','admin','operator']::text[])))
with check ((select private.has_company_role(company_id, array['owner','admin','operator']::text[])));

drop policy if exists device_groups_delete on public.device_groups;
create policy device_groups_delete on public.device_groups
for delete to authenticated
using ((select private.has_company_role(company_id, array['owner','admin','operator']::text[])));

drop policy if exists device_group_members_select on public.device_group_members;
create policy device_group_members_select on public.device_group_members
for select to authenticated
using ((select private.is_company_member(company_id)));

drop policy if exists device_group_members_insert on public.device_group_members;
create policy device_group_members_insert on public.device_group_members
for insert to authenticated
with check (
  added_by = (select auth.uid())
  and (select private.has_company_role(company_id, array['owner','admin','operator']::text[]))
);

drop policy if exists device_group_members_delete on public.device_group_members;
create policy device_group_members_delete on public.device_group_members
for delete to authenticated
using ((select private.has_company_role(company_id, array['owner','admin','operator']::text[])));

revoke all on public.device_groups from anon;
revoke all on public.device_group_members from anon;
grant select, insert, update, delete on public.device_groups to authenticated;
grant select, insert, delete on public.device_group_members to authenticated;

comment on column public.companies.fallback_playlist_id is
  'Company-wide emergency playlist. Device-specific fallback takes precedence.';
comment on column public.devices.fallback_playlist_id is
  'Optional emergency playlist for this device. Must belong to the same company.';
comment on table public.device_groups is
  'Company-isolated TV groups used for shared default programming.';


create or replace function public.set_device_group(
  p_company_id uuid,
  p_device_id uuid,
  p_group_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select private.has_company_role(p_company_id, array['owner','admin','operator']::text[])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.devices d where d.id=p_device_id and d.company_id=p_company_id and d.retired_at is null) then
    raise exception 'device_not_found' using errcode = 'P0002';
  end if;
  if p_group_id is not null and not exists (select 1 from public.device_groups g where g.id=p_group_id and g.company_id=p_company_id) then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  delete from public.device_group_members where company_id=p_company_id and device_id=p_device_id;
  if p_group_id is not null then
    insert into public.device_group_members(group_id,device_id,company_id,added_by)
    values (p_group_id,p_device_id,p_company_id,(select auth.uid()));
  end if;
end;
$$;

revoke all on function public.set_device_group(uuid,uuid,uuid) from public, anon;
grant execute on function public.set_device_group(uuid,uuid,uuid) to authenticated;

comment on column public.playlist_items.is_essential is
  'When true, failure to resolve this enabled item can activate an available fallback playlist.';


drop trigger if exists device_groups_company_writable on public.device_groups;
create trigger device_groups_company_writable
before insert or update or delete on public.device_groups
for each row execute function private.enforce_company_writable_row();

drop trigger if exists device_group_members_company_writable on public.device_group_members;
create trigger device_group_members_company_writable
before insert or update or delete on public.device_group_members
for each row execute function private.enforce_company_writable_row();

create or replace function public.set_company_fallback_playlist(
  p_company_id uuid,
  p_playlist_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (select private.has_company_role(p_company_id, array['owner','admin']::text[])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_playlist_id is not null and not exists (
    select 1 from public.playlists p where p.id=p_playlist_id and p.company_id=p_company_id
  ) then
    raise exception 'playlist_not_found' using errcode = 'P0002';
  end if;
  update public.companies
  set fallback_playlist_id=p_playlist_id
  where id=p_company_id;
  if not found then raise exception 'company_not_found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.set_company_fallback_playlist(uuid,uuid) from public, anon;
grant execute on function public.set_company_fallback_playlist(uuid,uuid) to authenticated;
