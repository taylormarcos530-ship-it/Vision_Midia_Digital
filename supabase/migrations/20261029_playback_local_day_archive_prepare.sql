-- Local-day archive preparation. Non-destructive and not scheduled.
-- This is a parallel table; existing UTC summary and reports remain untouched.
create table if not exists public.playback_daily_summary_local (
 play_date date not null,
 company_id uuid not null,
 device_id uuid not null,
 campaign_key text not null,
 media_key text not null,
 started bigint not null default 0,
 completed bigint not null default 0,
 total_seconds numeric not null default 0,
 first_play timestamptz,
 last_play timestamptz,
 primary key (play_date,company_id,device_id,campaign_key,media_key)
);
alter table public.playback_daily_summary_local enable row level security;
revoke all on public.playback_daily_summary_local from anon,authenticated;
-- Backfill in a separately reviewed migration. Company timezone must be
-- read from companies; never assume UTC or a fixed Sao Paulo offset.
-- Do not delete raw events until late offline uploads and report compatibility
-- are solved, and an independently restorable encrypted backup is verified.
