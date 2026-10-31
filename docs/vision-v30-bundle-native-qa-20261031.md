# Vision V30 — Validação do device-bundle-stable v3 em Supabase local (31/10/2026)

**Status:** PASS em stack local Deno + Auth/PostgREST + PostgreSQL 17; **NÃO autorizado para produção**. Sem deploy, modificação de Supabase hospedado/Vercel/APKs/TVs, SQL em base real, exclusão de comprovantes ou habilitação de retenção.

Branch: `fix/playback-daily-retention-safe-20261030`.

## Referência (somente leitura)

- Supabase production `device-bundle-stable` **v3**, hash publicado `b3f8b7eb010b08fb770e4c6109ca9d1ed418154d7f2df5c3cb0784bc7f16a7b8`; `device-gateway` **v22**, hash `80818c961a873df1e1953242fb92d2f5e793b2b064590bf88877586d91ce3031`.
- Proteções transplantadas à branch da v3 e aprovadas em Node mock (run 41206831719): limpeza pairing sob touch de credencial (60s / cruzamento de janela 5 min) e varredura offline por empresa e instância (30s) com `inFlight` e limiar OFFLINE de 90s.
- Diferenças intencionais adicionais na branch após a reconciliação v3: bloco `command_status` interno e proteção condicional `.in('status',['pending','sent'])` do resultado terminal. Fora disso, o algoritmo de heartbeat/manifest/programação não foi substituído por implementação nova.
- O bundle é **opt-in** para User-Agent `VisionPlayerAndroid/1.5.24-stable` e aceita **externamente apenas `cycle`**; `command_status` e `command_result` são funções internas de `runExistingGatewayAction` e não endpoints externos separados.

## Testes e medições comprovados

**GitHub Actions SUCCESS:** https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41208143790  
Commit exato testado: `43c31b3861942f702dee5f997997b0590eb5973a`.

Toda a pilha local foi criada em diretório temporário e inicializada via Supabase CLI 2.84.2; SDK real `@supabase/supabase-js@2.75.0`; PostgreSQL 17 local; credenciais e empresas fictícias.

### Ciclo completo por HTTP / Deno

- `PASS_BUNDLE_AUTH`: token desconhecido HTTP 401, User-Agent incompatível HTTP 403, rota externa `command_status` HTTP 400 (não há exposição involuntária).
- `PASS_BUNDLE_FIRST_CYCLE`: `commands` entregou 1 comando A, mudou `pending→sent`, limpou token de pareamento emitido e mudou uma TV de teste com heartbeat atrasado para `offline`.
- `PASS_BUNDLE_LOCAL_WRITES`: **12 ciclos** da mesma TV em execução local, observados via triggers de auditoria exclusivamente sintéticos:
  - `device_credentials`: **1 UPDATE real**;
  - `device_pairing_requests`: **1 UPDATE real**;
  - `device_commands`: **1 UPDATE real** para a primeira entrega; `sent` foi retransmitido sem UPDATE nas onze seguintes;
  - `device_heartbeats`: **1 INSERT real**;
  - `devices`: **13 UPDATEs reais**, sendo doze atualizações legítimas da TV em cada heartbeat mais uma atualização de TV atrasada `online→offline`.
- `PASS_BUNDLE_BLOCKS`: credencial revogada HTTP 401; empresa suspensa HTTP 403.
- Não foi medido o total de consultas SQL/GET, tentativas PATCH com zero linhas afetadas, custo de CPU, WAL ou latência em produção; a auditoria por trigger mede apenas gravações que atingem linhas.

### Rotinas internas contra PostgREST real

O teste executou **o código efetivo do bloco** `runExistingGatewayAction` da branch em Node VM com SDK/PostgREST reais do Supabase local. Não abriu nova rota HTTP nem inseriu código de teste na Edge Function implantada.
- `PASS_BUNDLE_STATUS`: leitura do comando `sent`; empresa B e TV B não conseguiram ler/confirmar comando da empresa A (HTTP 404).
- `PASS_BUNDLE_TERMINAL`: um resultado `completed` foi gravado uma vez; reenvio tardio `failed` recebeu ACK idempotente, sem substituir status terminal.
- `PASS_BUNDLE_RACE`: **12 requisições concorrentes** tentando resultados `completed` e `failed` para o mesmo comando geraram **exatamente um UPDATE terminal**; status final do ensaio `completed`.
- Esse teste valida o código de rotina interna com banco real; **não** prova `command_result` como chamada HTTP pública do bundle, que intencionalmente não oferece essa rota.

### Regressões / limites de alcance

- Node 22 sem Supabase: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41206831719 — **34/34 PASS**, incluindo 7 testes de ritmo de pareamento, 100 heartbeats em warm isolate = 1 varredura por empresa em 30s, concorrência de sweep, falha/retry, e limitação de state por instância. Dado crítico: **não é rate limiting global** quando múltiplos workers Deno processam requisições.
- O teste native 41208143790 verificou mudança OFFLINE, mas não contou **requisições PATCH sem linhas alteradas** e não simulou paralelismo entre instâncias Deno; não confundir 1 atualização OFFLINE com 1 tentativa de varredura.
- `include_manifest:true`, envio de `proofs` e `events` e screenshot não foram acionados neste novo ensaio; os trechos compartilhados com v3 permanecem no código da branch, porém não se pode declarar 100% das rotas homologadas pelo novo workflow.
- **Risco remanescente:** o handler de `playback_batch` interno do bundle ainda contém `String(...).slice(0,120)` e `continue` em eventos inválidos, de modo que um lote parcialmente inválido pode resultar em ACK parcial. A correção de lote íntegro do `device-gateway` v30 ainda precisa de reconciliação específica no bundle e teste do Player antes de publicar. NÃO alterar comportamento sem teste end-to-end.
- O bundle pode retornar `{ok:true,commands:{ok:false,...}}` se a busca de comandos falhar, pois agrega resultados. Exigir teste de falhas parciais e reconciliação de ACK por subação.
- As limitações do Supabase Free relacionadas a `exceed_edge_functions_invocations_quota` e `egress` são independentes dos testes locais e precisam de acompanhamento antes de rollout.

## Histórico dos problemas de QA antes de PASS

- Run 41207449363: SQL sintético dos comandos com parêntese extra (corrigido).
- Runs 41207614211/41207654340: HTTP 500 por permissão ausente da **tabela de auditoria do próprio teste**. Concedido INSERT/USAGE apenas no PostgreSQL local, sem mudar Edge Function.
- Run 41207948191: estrutura sintética sem coluna `retired_at` necessária para o filtro real de OFFLINE. Coluna adicionada apenas ao fixture de QA.
- Run 41208143790: **SUCCESS completo**, com resultados reais de autenticação, gravações, OFFLINE, status, terminal e concorrência.

## Próximos gates

1. Testar ciclo com lotes de `proofs` mistos e erros parciais, confirmar sem perda nem retry em loop, com Player 1.5.24 simulado.
2. Medir requisições tentadas (inclusive zero-row PATCH) e comportamento com múltiplas instâncias ou backend simulado, sem consultar produção.
3. Homologar `include_manifest`, `event_batch`, conectividade/offline e screenshot no mesmo stack local, ou registrar cobertura separada existente.
4. Backup real cifrado (só mediante autorização específica) e prova de restauração, TV Box Casa em bancada, rollback e quotas estáveis.
5. **NÃO** ativar retenção, deploy, migração ou atualização de APK/TV sem permissão; manter branch isolada.
