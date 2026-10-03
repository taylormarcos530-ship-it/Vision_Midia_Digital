-- Persistent Web Push + Master-only Player branding.

alter table public.platform_public_config
  add column if not exists web_push_public_key text;

create table if not exists public.web_push_config (
  id smallint primary key default 1 check (id = 1),
  vapid_public_key text not null,
  vapid_private_key text not null,
  subject text not null,
  updated_at timestamptz not null default now()
);

alter table public.web_push_config enable row level security;
revoke all privileges on public.web_push_config from anon, authenticated;
grant select, insert, update, delete on public.web_push_config to service_role;

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  check (char_length(endpoint) between 20 and 2048),
  check (char_length(p256dh) between 20 and 512),
  check (char_length(auth_key) between 8 and 256)
);

create index if not exists idx_web_push_subscriptions_company_active
  on public.web_push_subscriptions(company_id)
  where disabled_at is null;

create index if not exists idx_web_push_subscriptions_user_active
  on public.web_push_subscriptions(user_id)
  where disabled_at is null;

alter table public.web_push_subscriptions enable row level security;
revoke all privileges on public.web_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.web_push_subscriptions to service_role;

drop policy if exists company_player_branding_admin_insert on public.company_player_branding;
drop policy if exists company_player_branding_admin_update on public.company_player_branding;
drop policy if exists company_player_branding_member_select on public.company_player_branding;
revoke all privileges on public.company_player_branding from anon, authenticated;

comment on table public.web_push_subscriptions is
  'Backend-managed browser push subscriptions. Clients register through the web-push Edge Function.';
comment on table public.web_push_config is
  'Service-role-only VAPID configuration. Private key must never be exposed to clients.';
