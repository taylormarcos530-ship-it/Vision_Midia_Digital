-- Three independently editable plans for the public Rede Vision point catalog.
-- No changes to SaaS subscription plans, customer playlists, billing or advertisements.
create table if not exists public.vision_network_ad_plans (
  slot smallint primary key check (slot between 1 and 3),
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '' check (char_length(description) <= 280),
  price_cents integer check (price_cents between 0 and 100000000),
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint vision_network_plan_active_complete check
   (not active or (price_cents is not null and char_length(btrim(description)) > 0))
);
alter table public.vision_network_ad_plans enable row level security;
revoke all on public.vision_network_ad_plans from public,anon,authenticated;
grant select,insert,update,delete on public.vision_network_ad_plans to service_role;
insert into public.vision_network_ad_plans (slot,name,description,price_cents,active)
values (1,'Plano 1','',null,false),(2,'Plano 2','',null,false),(3,'Plano 3','',null,false)
on conflict (slot) do nothing;
comment on table public.vision_network_ad_plans is 'Three Master-editable commercial offers. Only configured active slots are returned to public catalog; never initiates payment.';