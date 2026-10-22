-- Three editable, globally-priced advertising plans for the Vision points directory.
-- Isolated from commercial campaigns, subscriptions, device firmware and playlists.
create table if not exists public.vision_network_plans (
  slot smallint primary key check (slot between 1 and 3),
  title text not null check (char_length(trim(title)) between 2 and 70),
  description text not null default '' check (char_length(description) <= 400),
  price_cents integer check (price_cents between 1 and 100000000),
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint vision_network_plans_active_price_check check (not active or price_cents is not null)
);
alter table public.vision_network_plans enable row level security;
revoke all on public.vision_network_plans from public,anon,authenticated;
grant select,insert,update,delete on public.vision_network_plans to service_role;
insert into public.vision_network_plans(slot,title,description,price_cents,active)
values (1,'7 dias','',null,false),(2,'15 dias','',null,false),(3,'30 dias','',null,false)
on conflict (slot) do nothing;
comment on table public.vision_network_plans is 'Exactly three Master-editable commercial plan slots; published only when explicitly activated, no payment collection';
