-- Applied to Supabase project Vision mídia digital.
-- Adds multi-tenant campaign scheduling and per-device targeting.
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  playlist_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 140),
  description text,
  start_date date,
  end_date date,
  start_time time without time zone,
  end_time time without time zone,
  weekdays smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  priority smallint not null default 50 check (priority between 0 and 1000),
  all_devices boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (playlist_id, company_id) references public.playlists(id, company_id) on delete cascade,
  check (end_date is null or start_date is null or end_date >= start_date),
  check ((start_time is null and end_time is null) or (start_time is not null and end_time is not null and start_time <> end_time)),
  check (cardinality(weekdays) between 1 and 7),
  check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  unique (id, company_id)
);

create table public.campaign_devices (
  campaign_id uuid not null,
  company_id uuid not null,
  device_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, device_id),
  foreign key (campaign_id, company_id) references public.campaigns(id, company_id) on delete cascade,
  foreign key (device_id, company_id) references public.devices(id, company_id) on delete cascade
);

create index campaigns_company_active_priority_idx on public.campaigns(company_id, is_active, priority desc, created_at desc);
create index campaigns_playlist_company_idx on public.campaigns(playlist_id, company_id);
create index campaigns_created_by_idx on public.campaigns(created_by);
create index campaign_devices_company_idx on public.campaign_devices(company_id);
create index campaign_devices_device_company_idx on public.campaign_devices(device_id, company_id);
create index campaign_devices_campaign_company_idx on public.campaign_devices(campaign_id, company_id);

create trigger campaigns_touch_updated_at before update on public.campaigns for each row execute function private.touch_updated_at();
create trigger campaigns_company_immutable before update on public.campaigns for each row execute function private.prevent_company_id_change();
create trigger campaigns_created_by_immutable before update on public.campaigns for each row execute function private.prevent_created_by_change();
create trigger campaign_devices_company_immutable before update on public.campaign_devices for each row execute function private.prevent_company_id_change();

alter table public.campaigns enable row level security;
alter table public.campaign_devices enable row level security;

create policy campaigns_select on public.campaigns for select to authenticated using ((select private.is_company_member(company_id)));
create policy campaigns_insert on public.campaigns for insert to authenticated with check (created_by = (select auth.uid()) and (select private.has_company_role(company_id, array['owner','admin','operator']::text[])));
create policy campaigns_update on public.campaigns for update to authenticated using ((select private.has_company_role(company_id, array['owner','admin','operator']::text[]))) with check ((select private.has_company_role(company_id, array['owner','admin','operator']::text[])));
create policy campaigns_delete on public.campaigns for delete to authenticated using ((select private.has_company_role(company_id, array['owner','admin','operator']::text[])));
create policy campaign_devices_select on public.campaign_devices for select to authenticated using ((select private.is_company_member(company_id)));
create policy campaign_devices_insert on public.campaign_devices for insert to authenticated with check ((select private.has_company_role(company_id, array['owner','admin','operator']::text[])));
create policy campaign_devices_delete on public.campaign_devices for delete to authenticated using ((select private.has_company_role(company_id, array['owner','admin','operator']::text[])));

revoke update on public.campaign_devices from authenticated;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, delete on public.campaign_devices to authenticated;
grant all on public.campaigns, public.campaign_devices to service_role;
