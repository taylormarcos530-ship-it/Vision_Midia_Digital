alter table public.devices
  add column if not exists access_status text not null default 'active',
  add column if not exists access_expires_at timestamptz null,
  add column if not exists access_updated_at timestamptz not null default now(),
  add column if not exists access_updated_by uuid null references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'devices_access_status_check'
      and conrelid = 'public.devices'::regclass
  ) then
    alter table public.devices
      add constraint devices_access_status_check
      check (access_status in ('pending','active','blocked'));
  end if;
end $$;

create index if not exists devices_access_expiry_idx
  on public.devices(access_status, access_expires_at)
  where retired_at is null;

comment on column public.devices.access_status is
  'Master-controlled TV authorization: pending, active or blocked.';
comment on column public.devices.access_expires_at is
  'Null means permanent access. Non-null active access expires at this timestamp.';
comment on column public.devices.access_updated_by is
  'Platform administrator who last changed the TV authorization.';
