# Homologação comercial — falha de permissão na limpeza corrigida

A segunda tentativa com Master no dia 18/10/2026 terminou com `staging_commercial_request_failed`. Logs SQL às 14:46:11 UTC mostraram `42501`, pois `service_role` não tem SELECT em `private.vision_staging_guard` na trigger `private.vision_revision_immutable`; a remoção da revisão falhou, seguida de FK 23503 na campanha. A consulta SQL pelo papel administrador tinha funcionado, escondendo essa diferença.

## Correção estrita
`supabase/sql/staging-virtual-trigger-definer-20261018.sql` torna o trigger existente `SECURITY DEFINER`, exigindo dono `postgres` e seu código de rejeição `immutable_revision`, mantendo `search_path TO ''` e a exceção restrita a revisões LAB-VIRTUAL cujo nome/UUID coincide. Não concede leitura do guard para `service_role`, não afrouxa revisões normais, não altera nenhuma migração Vision Menu e só se aplica ao banco `jmiuitrrhtaeyrpuyohk`.

## Aceitação exigida
- Executar testes transacionais **como service_role**, e não só como postgres: revisão LAB-VIRTUAL pode ser deletada quando corresponda ao checksum, enquanto UPDATE e qualquer revisão de campanha normal permanecem bloqueados.
- Remover somente campanha e revisão órfãs da segunda tentativa, após conferir guard de nomes/IDs e banco.
- Confirmar 0 dispositivos, empresas, mídias, revisões, arquivos e eventos virtuais; 2 campanhas de demonstração e Vision Menu preservados.
- Reexecutar ensaio remoto autenticado uma única vez e conferir retorno APROVADO + ausência de resíduos.
- **Sem deploy de produção, APK, gateway de TVs oficiais ou alteração de playlist da Life fundo.**
