# Inventário de lacunas — homologação Vision (2026-10-30)

Escopo: projeto Supabase **jmiuitrrhtaeyrpuyohk**, somente leitura; branch isolada `audit/playback-query-performance-20261030`. Não aplicar este documento como SQL.

## Confirmado em information_schema
- `companies`: id, name, owner_user_id; **sem** status (gateway consulta status).
- `devices`: id, company_id, name, last_seen_at, retired_at; **sem** status, access_status, access_expires_at, platform, orientation, paired_at, settings (gateway/claim-device dependem deles).
- `media_assets`: id, company_id, name, media_type, storage_path, source_url, duration_seconds, size_bytes, checksum_sha256, width, height, processing_status, updated_at.
- `playback_logs`: id, device_id, client_event_id, media_id (NOT NULL), started_at, ended_at, completed, created_at. Ausentes: company_id, campaign_id, playlist_id, duration_seconds, device_name, campaign_name, playlist_name, media_name. Gateway pode enviar media_id nulo.
- `company_members`: somente user_id; PK(user_id), FK(user_id). Faltam associação com company_id e papéis.
- Ausentes: `device_credentials`, `device_pairing_requests`, `device_claim_attempts`, `company_subscriptions`, `campaigns`, `playlists`.
- `playback_logs` tem UNIQUE(device_id,client_event_id), essencial para idempotência. Preservar.
- RLS habilitada nas quatro tabelas básicas verificadas; não foram encontradas políticas nelas. Gateway usa cliente administrativo com service role; nunca liberar tabelas de tokens para anon/authenticated.

## Evidências do código
- `supabase/functions/device-bootstrap/index.ts`: pareamento por hashes de código, segredo e origem; validade 10 min; emite token e grava hash na `device_credentials`; utiliza `device_pairing_requests`.
- `supabase/functions/claim-device/index.ts`: utiliza `device_claim_attempts` e colunas extras de `devices`.
- `supabase/functions/device-gateway/index.ts`: exige credencial, estado da empresa, assinatura e colunas de autorização; `playback_batch` usa upsert em `playback_logs`.
- `supabase/migrations/20260908024327_add_campaign_scheduling.sql` cria campaigns/campaign_devices, mas depende de playlists e funções private preexistentes.
- `supabase/migrations/20260908033339_add_saas_master_core.sql` cria plans/company_subscriptions, mas pressupõe private schema/funções e empresas compatíveis.
- `supabase/migrations/20261002173500_add_device_access_authorization.sql` adiciona autorização à tabela devices, mas não resolve as demais colunas.
- Migrações de snapshots e auditoria exigem colunas company_id e campaign_id em playback_logs.

## Ordem segura proposta (NÃO executada)
1. Recuperar o DDL original completo, incluindo funções private, policies, triggers, índices, checks e grants; conferir origem confiável.
2. Fazer backup verificável da homologação, inventário de objetos e plano de rollback.
3. Preparar migrações incrementais, idempotentes e versionadas; não modificar PK/FK existentes sem análise de dados.
4. Testar em banco descartável com dados fictícios: pareamento, autorização, playback único, batch duplicado, falha de gravação, retry, RLS e relatórios.
5. Validar contagem sem duplicidade, carga e logs; só então considerar homologação integrada.
6. Produção fora de escopo; sem merge, deploy, alteração de TV ou mudança no Supabase oficial.

## Bloqueadores
Não localizadas no GitHub consultado as definições originais completas de playlists, device_credentials e device_pairing_requests. **Não inventar** DDL de segurança ou credenciais. A estrutura de homologação é diferente da produção. Consultas de leitura não substituem teste integrado.
