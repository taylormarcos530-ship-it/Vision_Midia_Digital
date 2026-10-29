-- Preparação isolada. Não apaga dados nem altera o RPC atual.
-- Um registro por dia, TV, campanha e mídia. Preserva totais e períodos.
create table if not exists public.playback_daily_summary (
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
  primary key (play_date, company_id, device_id, campaign_key, media_key)
);
alter table public.playback_daily_summary enable row level security;
revoke all on public.playback_daily_summary from anon, authenticated;
-- Rodar somente com autorização e após backup verificado:
-- INSERT ... SELECT de playback_logs agrupados por dia/TV/campanha/mídia.
-- Validar SUM(started), SUM(completed) e SUM(total_seconds) antes de excluir.
-- Manter uma janela de segurança para eventos offline atrasados.
-- Não ativar DELETE, VACUUM FULL nem agendamento nesta migração.

-- Verification query: read-only, compare both counts before any retention deletion.
-- SELECT (SELECT count(*) FROM public.playback_logs WHERE started_at < now()-interval '32 days') AS source_events,
--        (SELECT coalesce(sum(started),0) FROM public.playback_daily_summary) AS summarized_events;
-- IMPORTANT: the current get_playback_report RPC reads playback_logs only.
-- Never delete historical events until that RPC is updated and tested with mixed date ranges.
-- The player should still preserve campaign playback proof and offline replay.
