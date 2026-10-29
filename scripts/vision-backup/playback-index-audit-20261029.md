# Vision — auditoria de índices playback_logs (2026-10-29)

## Diagnóstico somente leitura (produção)
- Banco: ~212 MB; playback_logs: ~183 MB (heap ~50 MB; índices ~133 MB).
- playback_logs_company_media_started_idx: ~20 MB, idx_scan=0 no snapshot.
- playback_logs_playlist_created_idx: ~13 MB, idx_scan=0 no snapshot.
- playback_logs_device_id_client_event_id_key: ~19 MB, idx_scan=253127; UNIQUE indispensável para deduplicação.
- Contadores idx_scan=0 não demonstram ausência de uso futuro. stats_reset em pg_stat_database retornou NULL.

## Código inspecionado
- supabase/migrations/20260908025545_add_playback_report_snapshots.sql cria company_media_started_idx.
- supabase/functions/device-gateway/index.ts grava playback_logs com upsert onConflict device_id,client_event_id e ignoreDuplicates; preservar índice UNIQUE.
- get_playback_report em produção consulta playback_logs com company_id, started_at, campaign_id e device_id; inclui detalhamento por mídia e últimos 250 eventos. Não lê arquivos resumidos.

## Bloqueios para remover índices
1. Verificar todas as consultas SQL e RPCs, inclusive externas e exportações, e seus planos EXPLAIN (ANALYZE somente no banco descartável).
2. Reproduzir esquema/volume representativo no PostgreSQL local Termux e comparar tempos e planos antes/depois da remoção de cada índice.
3. Confirmar backup restaurável e procedimento de recriação dos índices. DROP INDEX em produção pode bloquear transações; se autorizado, preferir operação CONCURRENTLY com monitoramento e janela de baixo tráfego.
4. Não remover PK nem índice UNIQUE de deduplicação; não apagar logs nem alterar player, APK ou relatórios.
5. Não prometer recuperação imediata de espaço sem medir pg_database_size após operação.

## Estado
**Apenas auditoria. Nenhum DROP, DELETE, migração ou publicação autorizado/executado.**
