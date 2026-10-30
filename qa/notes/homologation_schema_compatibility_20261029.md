# Compatibilidade de homologação — 29/10/2026

Comparação read-only de information_schema.columns entre:
- Produção: fpadgedrgcxrrqflzhjt
- Homologação: jmiuitrrhtaeyrpuyohk

## Bloqueios confirmados
- Homologação: public.campaigns e public.playlists ausentes.
- Homologação: private.is_company_member(uuid) ausente.
- Homologação: public.companies.timezone ausente.
- Homologação: public.playback_logs sem company_id, campaign_id, playlist_id, duration_seconds, device_name, campaign_name, playlist_name, media_name (entre outras colunas de produção).
- Homologação: public.devices possui company_id; a associação por devices pode ser usada somente em testes isolados, após validação de integridade.

## Plano seguro
1. Não executar qa/sql/playback_events_cursor_qa.sql nesta homologação: a função não compila no esquema atual.
2. Criar fixture sintética em schema privado de QA, com duas empresas fictícias, eventos com timestamps empatados e identidades fictícias. Sem copiar dados de produção.
3. Implementar teste de keyset exclusivamente sobre fixture, com isolamento por empresa e cursor (started_at,id), sem GRANT para anon/authenticated.
4. Validar 500+500 eventos, 0 sobreposições, inserção de novo evento antes da página 2, limite e pares de cursor.
5. Em ambiente que reproduza o schema atual, executar testes de contrato e autorização antes de considerar integração ao painel.

Nenhuma migração automática, alteração em produção ou instalação da função foi autorizada por este documento.
