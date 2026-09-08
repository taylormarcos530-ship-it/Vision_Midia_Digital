-- Vision Mídia Digital: operational monitoring telemetry and device event audit.

alter table public.devices
  add column if not exists last_sync_at timestamptz,
  add column if not exists current_campaign_id uuid,
  add column if not exists current_playlist_id uuid,
  add column if not exists current_media_id uuid,
  add column if not exists cache_items integer not null default 0,
  add column if not exists cache_bytes bigint not null default 0,
  add column if not exists playback_queue_size integer not null default 0,
  add column if not exists event_queue_size integer not null default 0,
  add column if not exists last_error_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text,
  add column if not exists last_recovered_at timestamptz;

alter table public.devices
  add constraint devices_cache_items_nonnegative check (cache_items >= 0),
  add constraint devices_cache_bytes_nonnegative check (cache_bytes >= 0),
  add constraint devices_playback_queue_nonnegative check (playback_queue_size >= 0),
  add constraint devices_event_queue_nonnegative check (event_queue_size >= 0),
  add constraint devices_last_error_code_length check (last_error_code is null or char_length(last_error_code) <= 80),
  add constraint devices_last_error_message_length check (last_error_message is null or char_length(last_error_message) <= 500);

create table public.device_events (
  id uuid primary key default gen_random_uuid(),
  client_event_id text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  device_id uuid not null,
  severity text not null check (severity in ('info','warning','error','critical')),
  event_code text not null check (char_length(event_code) between 1 and 80),
  message text not null check (char_length(message) between 1 and 500),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (device_id, company_id) references public.devices(id, company_id) on delete cascade,
  unique (device_id, client_event_id)
);

create index device_events_company_occurred_idx on public.device_events(company_id, occurred_at desc);
create index device_events_device_occurred_idx on public.device_events(device_id, occurred_at desc);
create index device_events_company_severity_occurred_idx on public.device_events(company_id, severity, occurred_at desc);
create index devices_company_last_seen_idx on public.devices(company_id, last_seen_at desc);
create index devices_company_last_error_idx on public.devices(company_id, last_error_at desc) where last_error_at is not null;

alter table public.device_events enable row level security;

create policy device_events_select on public.device_events
for select to authenticated
using ((select private.is_company_member(company_id)));

revoke all on public.device_events from anon, authenticated;
grant select on public.device_events to authenticated;
grant all on public.device_events to service_role;

comment on table public.device_events is 'Operational events emitted by Vision Player. Client users can only read events from companies allowed by RLS; writes are backend-only.';
comment on column public.devices.last_sync_at is 'Last successful player manifest synchronization reported by the device.';
comment on column public.devices.cache_bytes is 'Approximate bytes of locally cached playlist media reported by Vision Player.';
