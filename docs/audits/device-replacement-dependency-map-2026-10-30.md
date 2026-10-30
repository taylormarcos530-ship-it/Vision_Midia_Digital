# Dependências adicionais — pareamento e substituição de TVs (2026-10-30)

Análise estática do repositório na branch de auditoria; nenhuma operação de banco ou dispositivo.

## Função versionada
`supabase/migrations/20260908215300_add_atomic_device_replacement.sql` define `public.replace_device_from_pairing` com SECURITY DEFINER e EXECUTE apenas para service_role. Ela:
1. valida empresa, licença, TV antiga e solicitação de pareamento;
2. bloqueia TV antiga e revoga credencial;
3. cria nova TV preservando settings;
4. migra `device_playlist_assignments` e `campaign_devices`;
5. vincula o pareamento à nova TV.

Dependências explícitas: `private.ensure_company_writable`, `private.company_license_allowed`, `public.devices` (campos adicionais), `public.device_pairing_requests`, `public.device_credentials`, `public.device_playlist_assignments`, `public.campaign_devices`.

## Implicação
A criação original de `device_playlist_assignments` também não foi localizada nas buscas de migrações do repositório. Não executar esta função na homologação incompleta. Para testar apenas deduplicação de reproduções, preferir um harness de integração isolado com cliente de banco simulado, sem parear TV real.

## Critérios antes de migrar
- Obter DDL original completo de todas as dependências, constraints, índices, RLS, grants e triggers.
- Preservar a unicidade `(device_id,client_event_id)`.
- Não criar tokens de produção nem copiar segredos.
- Verificar transação e rollback em ambiente descartável.
- Nunca executar alteração em produção sem autorização específica.
