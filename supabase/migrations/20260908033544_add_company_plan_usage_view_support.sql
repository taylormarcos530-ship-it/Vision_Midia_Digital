create index if not exists company_members_company_status_idx on public.company_members(company_id, status);
create index if not exists devices_company_last_seen_idx on public.devices(company_id, last_seen_at desc);
create index if not exists media_assets_company_size_idx on public.media_assets(company_id, size_bytes);
create index if not exists campaigns_company_active_idx on public.campaigns(company_id, is_active);
