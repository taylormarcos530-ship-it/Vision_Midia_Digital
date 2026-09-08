alter table public.playback_logs add column campaign_id uuid;
create index playback_logs_campaign_created_idx on public.playback_logs(campaign_id, created_at desc) where campaign_id is not null;
create index playback_logs_company_campaign_created_idx on public.playback_logs(company_id, campaign_id, created_at desc) where campaign_id is not null;
