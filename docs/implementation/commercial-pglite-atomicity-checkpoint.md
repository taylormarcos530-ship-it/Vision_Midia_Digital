# Vision Mídia Digital — Homologação SQL em PostgreSQL embarcado (PGlite)

**Checkpoint de origem:** `2ecea39264f2284ecb16acacff44d11e90e6983f`.  
**Branch isolada:** `fix/advertiser-portal-safety-20261013`.  
**Escopo:** teste local com `@electric-sql/pglite` já existente no projeto, sem Supabase, servidor remoto, banco de clientes, migrations ou deploy.

## Arquivos desta etapa

- `tests/commercial-receipt-pglite-atomicity.test.cjs` — novo teste com **13 subtestes SQL executados de verdade** em um PostgreSQL embutido exclusivamente em memória. Cria ali o esquema temporário fictício `lab_commercial`, duas TVs, ocorrências comerciais, recibos e seis mídias base de oficina.
- Este documento resume evidências, limitações e os critérios para futura autorização de staging separado.

**Não modificado:** `player.js`, APK/`android-player`, `supabase/functions/device-gateway/index.ts`, arquivos SQL operacionais, tabelas `playback_logs`, playlists, configurações de produção, Edge Functions e arquivos Netlify/Vercel.

## Verificações executadas

1. Chaves efetivamente criadas pelo PostgreSQL: `PRIMARY KEY(device_id,client_event_id)` e `UNIQUE(device_id,occurrence_id)`, além de FK composta por revisão comercial.
2. Repetir um `client_event_id` com mesmo conteúdo retorna duplicidade sem inserir nova linha. Tentar reaproveitar a mesma ocorrência com outro ID não altera o ledger.
3. Rejeição real por índice único de segundo recibo destinado à mesma ocorrência.
4. IDs de evento e ocorrência repetidos são permitidos entre duas TVs distintas, mas não atravessam seus escopos. A identidade autenticada é **fixture injetada pelo teste**, não um token validado.
5. `BEGIN` + primeira inserção + segunda inserção com violação de unicidade + `ROLLBACK`: nenhuma inserção da transação permanece.
6. `COMMIT` realizado com ACK supostamente perdido: reenvio idêntico encontra linha já aceita.
7. Desativação/cancelamento em transação antes da primeira entrega recusa a conclusão antiga; as seis mídias base permanecem inalteradas.
8. Confirmação aceita antes da desativação permanece histórica e é deduplicada posteriormente.
9. Primeira entrega 12 horas após TTL fictício expirar é recusada; conteúdo base intacto.
10. `CHECK` real impede `completed=true` com término nulo.
11. Vinte inserções simultaneamente solicitadas à **mesma conexão PGlite**, usando `ON CONFLICT DO NOTHING`, gravam uma única linha. **Não demonstra isolamento real entre conexões**.
12. Resumos computados da tabela aceita, sem somar reenvios: uma conclusão e uma tentativa incompleta resultam em `attempts=2`, `completed=1`, no dia de recebimento de São Paulo.
13. Verificação de que nenhum módulo operacional importa a bancada, e de que o SQL conceitual anterior continua documentado como não executável em produção.

**GitHub Actions:** 310/310 testes, 0 falhas, proteção do player/API operacional aprovada.  
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38658344714

## O que NÃO foi comprovado

- O PGlite embutido usa uma conexão e serializa suas requisições. Não substitui testes de `READ COMMITTED`/`SERIALIZABLE`, lock contention, deadlock, timeout, queda de conexão, `ON CONFLICT` sob corrida real de **sessões PostgreSQL independentes**, nem PgBouncer.
- O exemplo de recebimento usa horário de servidor **injetado na fixture**. Em staging real, o horário deve ser lido após lock e aplicado com critérios de autenticação e validade; não confiar em parâmetros do aplicativo.
- Nenhuma RLS, autorização Supabase, chave de mídia, Storage, Edge Function, Android TV, playback físico ou mídia comercial do cliente foi testada.
- PGlite testa integridade de registros, não prova que pixels comerciais foram exibidos na TV. Recibos `completed=true` continuam declarações não auditadas.
- A política para primeiro evento enviado 12–48h offline não está resolvida; esta bancada recusa recebimento após o TTL de cinco minutos. Uma futura política segura precisa preservar conteúdo local mesmo quando rejeitar contagem.
- A atribuição do dia no laboratório se baseia em chegada ao servidor. O relatório SQL comercial existente usa o início da reprodução; é **uma diferença pendente de decisão**, não pode ser mascarada.

## Próximo portão de homologação — ainda sem autorização de execução

Preparar para revisão uma bateria de **duas ou mais conexões PostgreSQL independentes** em um servidor de staging genuinamente separado, com rollback não destrutivo, prazo, limites de concorrência e logs completos. Os cenários obrigatórios incluem: 32 envios idênticos concorrentes, 32 IDs diferentes concorrendo pela mesma ocorrência, publicação de cancelamento contra recibo, queda antes/depois de COMMIT, lotes de 100 eventos e entrega tardia na virada de dia.

**Critérios para sequer iniciar:** projeto de staging identificado explicitamente e verificado como distinto de produção; dados e usuários sintéticos; autenticação de TV homologada; backups/checkpoints; RLS e permissões revisadas; migrations de staging revisadas separadamente; flag comercial desligada; rollback descrito e autorização explícita do usuário. **Não provisionar nem executar staging automaticamente.**

### Reversão prevista, sem destruir dados

Ao encontrar falha, interromper somente novas emissões comerciais em staging, preservar registros para auditoria, manter manifestos base e `Aguardando playlist`, e registrar o erro de concorrência. Nunca apagar `playback_logs` ou playlists do cliente; não promover deploy nem tocar nas TVs oficiais. A correção deverá ser revisada e testada na branch de laboratório.

## Checkpoint curto para próxima conversa

Retomar na branch `fix/advertiser-portal-safety-20261013` após este documento. SQL local PGlite e regressão geral PASS; nada de produção foi alterado. Próxima etapa segura: matriz de aceitação e harness **de especificação** para testes de sessões PostgreSQL independentes em staging futuramente autorizado, sem migrations nem deploy.
