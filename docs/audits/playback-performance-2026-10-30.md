# Vision — auditoria de performance de reproduções (isolada)

Data: 2026-10-30. Somente análise; não aplicar em produção sem aprovação.

## Evidências
- public.playback_logs: ~201 mil linhas estimadas; ~51 MB de dados e ~135 MB de índices.
- pg_stat_statements: ~200.014 INSERTs de playback_logs, média ~13,86 ms. Contadores acumulados, não taxa atual.
- device-gateway/index.ts: action playback/playback_batch aceita 1 a 100 eventos; grava via upsert onConflict=device_id,client_event_id, ignoreDuplicates=true.
- Gateway faz consultas de nomes por lote, em paralelo, apenas quando existem IDs.
- Relatórios get_playback_report/get_playback_events filtram company_id, started_at e opcionalmente campaign_id/device_id.
- Índices company_media_started (~20 MB, 2 scans) e playlist_created (~13 MB, 1 scan) têm baixo número de scans, mas idx_tup_read significativo. Não excluir sem evidência.

## Salvaguardas
1. Não alterar índices, RLS, triggers, RPCs, retenção ou player no banco oficial.
2. Preservar deduplicação por (device_id, client_event_id), chave primária e todos os eventos válidos.
3. Não introduzir cache compartilhado de metadados sem TTL/invalidação e comparação de custo; cache não deve afetar contabilização.
4. Não executar EXPLAIN ANALYZE nem consultas pesadas na produção; preferir EXPLAIN sem ANALYZE ou ambiente de homologação.
5. Não mudar branch main, não publicar Vercel, não atualizar TV Boxes.

## Plano de teste
- Obter baseline de latência p50/p95 e chamadas por lote de 1/10/50/100 eventos em banco isolado com dados sintéticos.
- Comparar comportamento de eventos repetidos, inválidos, fora de ordem, offline e mídia removida.
- Validar contagens por empresa/TV/campanha e exportação idênticas antes/depois.
- Medir espaço e planos de execução para filtros por empresa, data, TV, campanha, mídia e playlist.
- Só propor alteração quando houver benefício medido e rollback documentado.

## Decisão atual
Nenhuma exclusão de índice recomendada. Priorizar mensuração de chamadas do gateway e custo de relatórios; alterações futuras apenas em branch de teste, com revisão antes de merge.
