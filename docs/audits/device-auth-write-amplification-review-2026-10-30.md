# Auditoria isolada — gravações durante autenticação

## Achados confirmados no código

- `supabase/functions/device-gateway/index.ts`: após autenticação e validação de conta, executa `UPDATE device_credentials SET last_used_at = now()` por `device_id` e `UPDATE device_pairing_requests SET issued_token = NULL` por `device_id` com `status='issued'`.
- `supabase/functions/device-monitoring/index.ts`: após validação da credencial e do dispositivo, também executa `UPDATE device_credentials SET last_used_at = now()` por `device_id`.
- `supabase/functions/device-bootstrap/index.ts`: durante o fluxo de pareamento, cria/substitui credencial e registra token emitido; alterar a limpeza de `issued_token` sem testes de pareamento pode causar regressões.

## Riscos e limites

As atualizações podem ocorrer em cada requisição autenticada, mas não há medição nova de frequência nesta auditoria. A operação de limpeza pode atingir zero linhas após o primeiro uso, porém ainda representa uma consulta enviada. Não presumir economia quantificada.

## Proposta conservadora, NÃO IMPLEMENTADA

1. Confirmar esquema, índices e semântica de `last_used_at` e `issued_token` em ambiente isolado.
2. Medir chamadas por TV e serviço antes de modificar.
3. Avaliar um limite temporal de escrita para `last_used_at`, com filtro no banco e sem cache de autorização; verificar concorrência.
4. Manter verificação de token revogado e status da TV em **toda** requisição.
5. Preservar limpeza de `issued_token` até testar emissão, recuperação e reinício do pareamento.
6. Validar em Deno com banco descartável e rollback antes de qualquer deploy.

Nenhum código operacional, migração, TV, APK ou projeto Supabase foi modificado por este documento.
