alter table public.playback_logs
  add column if not exists device_name text,
  add column if not exists campaign_name text,
  add column if not exists playlist_name text,
  add column if not exists media_name text;

create index if not exists playback_logs_company_started_idx on public.playback_logs(company_id, started_at desc);
create index if not exists playback_logs_company_device_started_idx on public.playback_logs(company_id, device_id, started_at desc);
create index if not exists playback_logs_company_campaign_started_idx on public.playback_logs(company_id, campaign_id, started_at desc) where campaign_id is not null;
create index if not exists playback_logs_company_media_started_idx on public.playback_logs(company_id, media_id, started_at desc) where media_id is not null;
