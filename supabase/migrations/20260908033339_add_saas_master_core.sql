-- Vision Midia Digital: SaaS Master foundation

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'super_admin' check (role in ('super_admin','admin','support')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;
grant all on public.platform_admins to service_role;

create table if not exists private.platform_admin_allowlist (
  email text primary key,
  role text not null default 'super_admin' check (role in ('super_admin','admin','support')),
  created_at timestamptz not null default now()
);
revoke all on private.platform_admin_allowlist from public, anon, authenticated;
grant all on private.platform_admin_allowlist to service_role;

insert into private.platform_admin_allowlist(email, role)
values ('taylormarcos530@gmail.com', 'super_admin')
on conflict (email) do update set role = excluded.role;

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  monthly_price_cents integer not null default 0 check (monthly_price_cents >= 0),
  max_devices integer check (max_devices is null or max_devices >= 0),
  storage_limit_mb integer check (storage_limit_mb is null or storage_limit_mb >= 0),
  max_users integer check (max_users is null or max_users >= 1),
  max_campaigns integer check (max_campaigns is null or max_campaigns >= 0),
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.plans enable row level security;
revoke all on public.plans from public, anon;
grant select on public.plans to authenticated;
grant all on public.plans to service_role;
create policy plans_authenticated_read_active on public.plans
for select to authenticated
using (is_active = true);

create table if not exists public.company_subscriptions (
  company_id uuid primary key references public.companies(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  status text not null default 'trialing' check (status in ('trialing','active','past_due','suspended','cancelled')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  manual_price_cents integer check (manual_price_cents is null or manual_price_cents >= 0),
  limit_overrides jsonb not null default '{}'::jsonb,
  billing_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.company_subscriptions enable row level security;
revoke all on public.company_subscriptions from public, anon;
grant select on public.company_subscriptions to authenticated;
grant all on public.company_subscriptions to service_role;
create policy company_subscriptions_member_read on public.company_subscriptions
for select to authenticated
using ((select private.is_company_member(company_id)));

create table if not exists public.master_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 2 and 100),
  company_id uuid references public.companies(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.master_audit_logs enable row level security;
revoke all on public.master_audit_logs from public, anon, authenticated;
grant all on public.master_audit_logs to service_role;

create index if not exists company_subscriptions_plan_idx on public.company_subscriptions(plan_id);
create index if not exists master_audit_logs_actor_created_idx on public.master_audit_logs(actor_user_id, created_at desc);
create index if not exists master_audit_logs_company_created_idx on public.master_audit_logs(company_id, created_at desc);
create index if not exists master_audit_logs_target_created_idx on public.master_audit_logs(target_user_id, created_at desc);

create or replace function private.touch_platform_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.sync_platform_admin_from_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_role text;
begin
  if new.email is null or new.email_confirmed_at is null then
    return new;
  end if;

  select a.role into allowed_role
  from private.platform_admin_allowlist a
  where lower(a.email) = lower(new.email)
  limit 1;

  if allowed_role is not null then
    insert into public.platform_admins(user_id, role, status)
    values (new.id, allowed_role, 'active')
    on conflict (user_id) do update
      set role = excluded.role,
          status = 'active',
          updated_at = now();
  end if;
  return new;
end;
$$;

create or replace function private.is_platform_admin(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = coalesce(p_user_id, (select auth.uid()))
      and pa.status = 'active'
      and pa.role in ('super_admin','admin','support')
  );
$$;

create or replace function private.company_limit_value(p_company_id uuid, p_key text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  override_value text;
  plan_value bigint;
begin
  select cs.limit_overrides ->> p_key
    into override_value
  from public.company_subscriptions cs
  where cs.company_id = p_company_id;

  if override_value is not null and override_value ~ '^\d+$' then
    return override_value::bigint;
  end if;

  select case p_key
    when 'max_devices' then p.max_devices::bigint
    when 'storage_limit_mb' then p.storage_limit_mb::bigint
    when 'max_users' then p.max_users::bigint
    when 'max_campaigns' then p.max_campaigns::bigint
    else null
  end
  into plan_value
  from public.company_subscriptions cs
  join public.plans p on p.id = cs.plan_id
  where cs.company_id = p_company_id;

  return plan_value;
end;
$$;

create or replace function private.ensure_company_writable(p_company_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  company_status text;
  subscription_status text;
begin
  select c.status into company_status from public.companies c where c.id = p_company_id;
  if company_status is null then raise exception 'company_not_found' using errcode = 'P0001'; end if;
  if company_status <> 'active' then raise exception 'company_suspended' using errcode = 'P0001'; end if;

  select cs.status into subscription_status from public.company_subscriptions cs where cs.company_id = p_company_id;
  if subscription_status in ('suspended','cancelled') then
    raise exception 'subscription_inactive' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.enforce_device_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare max_allowed bigint; used_count bigint;
begin
  perform private.ensure_company_writable(new.company_id);
  max_allowed := private.company_limit_value(new.company_id, 'max_devices');
  if max_allowed is null then return new; end if;
  select count(*) into used_count from public.devices d where d.company_id = new.company_id;
  if used_count >= max_allowed then raise exception 'plan_device_limit_reached' using errcode = 'P0001'; end if;
  return new;
end;
$$;

create or replace function private.enforce_campaign_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare max_allowed bigint; used_count bigint;
begin
  perform private.ensure_company_writable(new.company_id);
  max_allowed := private.company_limit_value(new.company_id, 'max_campaigns');
  if max_allowed is null then return new; end if;
  select count(*) into used_count from public.campaigns c where c.company_id = new.company_id;
  if used_count >= max_allowed then raise exception 'plan_campaign_limit_reached' using errcode = 'P0001'; end if;
  return new;
end;
$$;

create or replace function private.enforce_member_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare max_allowed bigint; used_count bigint;
begin
  max_allowed := private.company_limit_value(new.company_id, 'max_users');
  if max_allowed is null then return new; end if;
  select count(*) into used_count from public.company_members cm where cm.company_id = new.company_id and cm.status <> 'disabled';
  if used_count >= max_allowed then raise exception 'plan_user_limit_reached' using errcode = 'P0001'; end if;
  return new;
end;
$$;

create or replace function private.enforce_media_storage_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare max_mb bigint; max_bytes numeric; used_bytes numeric;
begin
  perform private.ensure_company_writable(new.company_id);
  max_mb := private.company_limit_value(new.company_id, 'storage_limit_mb');
  if max_mb is null then return new; end if;
  max_bytes := max_mb::numeric * 1024 * 1024;
  select coalesce(sum(coalesce(m.size_bytes,0)),0) into used_bytes
  from public.media_assets m
  where m.company_id = new.company_id and (tg_op = 'INSERT' or m.id <> new.id);
  if used_bytes + coalesce(new.size_bytes,0) > max_bytes then raise exception 'plan_storage_limit_reached' using errcode = 'P0001'; end if;
  return new;
end;
$$;

create or replace function private.handle_new_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and new.owner_user_id <> (select auth.uid()) then raise exception 'invalid company owner'; end if;
  insert into public.company_members(company_id, user_id, role, status) values (new.id, new.owner_user_id, 'owner', 'active');
  return new;
end;
$$;

revoke all on function private.is_platform_admin(uuid) from public, anon, authenticated;
revoke all on function private.company_limit_value(uuid,text) from public, anon, authenticated;
revoke all on function private.ensure_company_writable(uuid) from public, anon, authenticated;
revoke all on function private.sync_platform_admin_from_allowlist() from public, anon, authenticated;
revoke all on function private.enforce_device_plan_limit() from public, anon, authenticated;
revoke all on function private.enforce_campaign_plan_limit() from public, anon, authenticated;
revoke all on function private.enforce_member_plan_limit() from public, anon, authenticated;
revoke all on function private.enforce_media_storage_limit() from public, anon, authenticated;

drop trigger if exists platform_admins_touch_updated_at on public.platform_admins;
create trigger platform_admins_touch_updated_at before update on public.platform_admins for each row execute function private.touch_platform_updated_at();
drop trigger if exists plans_touch_updated_at on public.plans;
create trigger plans_touch_updated_at before update on public.plans for each row execute function private.touch_platform_updated_at();
drop trigger if exists company_subscriptions_touch_updated_at on public.company_subscriptions;
create trigger company_subscriptions_touch_updated_at before update on public.company_subscriptions for each row execute function private.touch_platform_updated_at();

drop trigger if exists auth_sync_platform_admin on auth.users;
create trigger auth_sync_platform_admin after insert or update of email, email_confirmed_at on auth.users for each row execute function private.sync_platform_admin_from_allowlist();

drop trigger if exists devices_enforce_plan_limit on public.devices;
create trigger devices_enforce_plan_limit before insert on public.devices for each row execute function private.enforce_device_plan_limit();
drop trigger if exists campaigns_enforce_plan_limit on public.campaigns;
create trigger campaigns_enforce_plan_limit before insert on public.campaigns for each row execute function private.enforce_campaign_plan_limit();
drop trigger if exists company_members_enforce_plan_limit on public.company_members;
create trigger company_members_enforce_plan_limit before insert on public.company_members for each row execute function private.enforce_member_plan_limit();
drop trigger if exists media_assets_enforce_storage_limit on public.media_assets;
create trigger media_assets_enforce_storage_limit before insert or update of size_bytes, company_id on public.media_assets for each row execute function private.enforce_media_storage_limit();

insert into public.plans(name, slug, description, monthly_price_cents, max_devices, storage_limit_mb, max_users, max_campaigns, features, sort_order)
values
  ('Start', 'start', 'Para pequenos pontos com uma TV.', 4900, 1, 2048, 2, 10, '{"reports":true,"monitoring":true,"scheduling":true}'::jsonb, 10),
  ('Pro', 'pro', 'Para operações com várias telas.', 9900, 5, 10240, 5, 50, '{"reports":true,"monitoring":true,"scheduling":true,"priority_support":false}'::jsonb, 20),
  ('Business', 'business', 'Para redes e operações maiores.', 19900, 20, 51200, 15, 250, '{"reports":true,"monitoring":true,"scheduling":true,"priority_support":true}'::jsonb, 30)
on conflict (slug) do nothing;

insert into public.platform_admins(user_id, role, status)
select u.id, a.role, 'active'
from auth.users u
join private.platform_admin_allowlist a on lower(a.email) = lower(u.email)
where u.email_confirmed_at is not null
on conflict (user_id) do update set role = excluded.role, status = 'active', updated_at = now();
