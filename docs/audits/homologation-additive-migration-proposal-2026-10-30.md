# Proposta de migração aditiva — homologação Vision (NÃO EXECUTAR AUTOMATICAMENTE)

Projeto de destino exclusivo: `jmiuitrrhtaeyrpuyohk`.
**Não executar na produção** `fpadgedrgcxrrqflzhjt`.

## Inventário verificado
- `playback_logs`: vazia na homologação; PK(id), UNIQUE(device_id,client_event_id), FK(device_id) -> devices(id).
- RLS habilitado em companies, devices, media_assets e playback_logs.
- Não há tabelas public.campaigns nem public.playlists.
- Campos ausentes em playback_logs: company_id, campaign_id, playlist_id, duration_seconds, device_name, campaign_name, playlist_name, media_name.

## Etapa 1: colunas aditivas (rascunho SQL; requer revisão de constraints, tipos e funções)
```sql
BEGIN;
ALTER TABLE public.playback_logs
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS campaign_id uuid,
  ADD COLUMN IF NOT EXISTS playlist_id uuid,
  ADD COLUMN IF NOT EXISTS duration_seconds numeric,
  ADD COLUMN IF NOT EXISTS device_name text,
  ADD COLUMN IF NOT EXISTS campaign_name text,
  ADD COLUMN IF NOT EXISTS playlist_name text,
  ADD COLUMN IF NOT EXISTS media_name text;
ROLLBACK; -- substitua por COMMIT apenas após revisão e aprovação
```

**Importante:** isso não torna o gateway compatível: faltam tabelas campaigns/playlists, políticas e possivelmente outras dependências de autenticação. Não criar essas tabelas por suposição. Examinar as migrações oficiais completas, a estrutura atual e as dependências antes de executar qualquer DDL.

## Critérios para liberação
1. Confirmar tipos, defaults, triggers e FKs da produção por leitura.
2. Conferir políticas RLS, grants e consumers da homologação.
3. Preparar migração completa, idempotente e rollback.
4. Validar somente com dados sintéticos e sem copiar dados de anunciantes.
5. Rodar testes de lote e reenvio no ambiente isolado.
6. Sem merge/deploy na produção até relatório de resultados e aprovação.

Estado: **PROPOSTA NÃO APLICADA**.
