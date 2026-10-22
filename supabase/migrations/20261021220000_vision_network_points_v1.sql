-- Rede de Pontos Vision v1: independent commercial directory, no player/playlist changes.
-- Apply only with explicit approval for the official Supabase project.
create table if not exists public.vision_network_points (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,100}$'),
  name text not null check (char_length(name) between 2 and 120),
  category text not null default 'Comércio' check (char_length(category) between 2 and 70),
  city text not null default '' check (char_length(city) <= 100),
  neighborhood text not null default '' check (char_length(neighborhood) <= 100),
  public_address text not null default '' check (char_length(public_address) <= 220),
  opening_hours text not null default '' check (char_length(opening_hours) <= 220),
  estimated_daily_visitors integer check (estimated_daily_visitors between 0 and 1000000),
  photo_paths text[] not null default '{}'::text[] check (cardinality(photo_paths) <= 3),
  share_address boolean not null default false,
  consent_confirmed_at timestamptz,
  consent_confirmed_by uuid references auth.users(id) on delete set null,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vision_network_publish_requires_consent
    check (not published or (consent_confirmed_at is not null and consent_confirmed_by is not null
         and nullif(trim(city),'') is not null and nullif(trim(neighborhood),'') is not null)),
  constraint vision_network_address_requires_consent
    check (not share_address or (consent_confirmed_at is not null and consent_confirmed_by is not null))
);
create index if not exists vision_network_points_public_idx
 on public.vision_network_points (city,category,name) where published;
create table if not exists public.vision_network_point_tvs (
  point_id uuid not null references public.vision_network_points(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete restrict,
  screen_inches integer check (screen_inches between 10 and 120),
  placement text not null default '' check (char_length(placement) <= 120),
  primary key (point_id,device_id),
  unique(device_id)
);
create index if not exists vision_network_point_tvs_device_idx
 on public.vision_network_point_tvs (device_id);
alter table public.vision_network_points enable row level security;
alter table public.vision_network_point_tvs enable row level security;
revoke all on public.vision_network_points from public,anon,authenticated;
revoke all on public.vision_network_point_tvs from public,anon,authenticated;
grant select,insert,update,delete on public.vision_network_points to service_role;
grant select,insert,update,delete on public.vision_network_point_tvs to service_role;
comment on table public.vision_network_points is 'Master-curated marketing directory; only approved published rows are returned by vision-network-points Edge';
comment on table public.vision_network_point_tvs is 'Screens associated with public marketing point; no changes to device programming';
