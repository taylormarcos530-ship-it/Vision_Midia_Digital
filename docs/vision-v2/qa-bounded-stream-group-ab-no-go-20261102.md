# Vision V2 — PostgreSQL 17: comparação A/B de transações de streaming (1 vs 2 blocos)

**Data:** 02/11/2026. **Branch exclusiva:** `experiment/vision-v2-sequence-watermark-qa-20261031`.
**Base intacta:** `e6cb8854bfcc9fe6023a80cae0d3989c50532876`.
**Código final testado:** `f30174714223166007175da0bcaadef61c599927`.
**Decisão: candidato de 2 blocos REJEITADO para ativação (falta de ganho consistente). Comportamento padrão continua `QA_STREAM_GUARD_GROUP=1`. PRODUÇÃO NO-GO.**
Não houve acesso ao Supabase oficial, nem alteração de APK, painel, site, TVs, históricos reais ou main. Tudo é QA sintético sob PostgreSQL 17 descartável no GitHub Actions; não é software implantado.

## Diagnóstico do problema original
Os até 20 HTTP 503 com 300 clientes surgem principalmente durante cutover/COMMIT comercial após o início do corpo HTTP 200: cada bloco exige lock compartilhado, RLS/JWT sintético e verificação da revisão, e o commit exclusivo pode intercalar **entre blocos**. O servidor interrompe o stream antes de escrever bytes com a revisão revogada; o proxy que ainda está coletando o HTTP 200 upstream recebe `IncompleteRead` e responde 503. Isto é **fail-closed intencional**, distinto do TOCTOU de admissão corrigido antes com lock->SELECT na mesma transação.

**Candidato experimental:** agrupar **até dois blocos** numa única transação de lock compartilhado, com `txguard(...,revision)`/membership executado para **cada bloco**; mantém SHA-256, AES-GCM em repouso, outbox original, controle de pool e rollback. A transação shared lock maior pode **adiar COMMIT comercial e revogação**. Não é garantia de fechamento físico de TCP nem estratégia de writer-priority. O código usa um flag **somente QA** `QA_STREAM_GUARD_GROUP`, assertivamente limitado a 1 ou 2, com default **1**.

## Execuções reais e PASS/FAIL, preservando regressões

- [41445509874](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41445509874): **12/12 PASS** na regressão AES-GCM/outbox/RLS/pool/relatório original após adicionar a opção inativa, com default=1. [41445509921](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41445509921): sequência/offline **PASS**.
- [41445880679](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41445880679): **FAIL de fixture** na primeira comparação A/B: o teste determinístico tentou inicializar a mesma base depois de outro runner, encontrando `DuplicateObject: role authenticated already exists`. O HTTP comercial que precedeu o erro teve PASS técnico. Preservar FAIL e seus logs; NÃO contar como aprovação total.
- [41445879690](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41445879690): regressão do código original no mesmo commit da primeira comparação, **12/12 PASS**.
- [41446077932](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41446077932): correção isolada da ordem do workflow (prova de revogação antes dos testes que preparam a fixture) — **12/12 jobs PASS**, com **12 artefatos** de logs. Código validado `f30174714223166007175da0bcaadef61c599927`.
- Commits: `180bc49dc658533c07fce1e732c633d51af2d1a8` (opção experimental inativa), `623f6cd60dc980b2e2a6bf230a609bf9be5f13bd` (prova determinística + matriz A/B), `f30174714223166007175da0bcaadef61c599927` (ordem segura das fixtures). Nenhum rollback que apagasse versões anteriores.

## Comparação comercial A/B — 300 clientes com cutover, COMMIT, rollback e recuperação

| Pool | Chunk | Original, grupo=1: HTTP 200/503 | Candidato, grupo=2: HTTP 200/503 | Grupo=1: P95/P99 ms | Grupo=2: P95/P99 ms | Veredito de redução |
|---:|---:|---|---|---|---|---|
| 8 | 64 KiB | 300 / 0 | 300 / 0 | 2322 / 2745 | 2039 / 2869 | Empate em 503 |
| 8 | 256 KiB | 298 / 2 | 297 / 3 | 1552 / 1953 | 1758 / 2111 | Pior |
| 12 | 64 KiB | 297 / 3 | 288 / 12 | 1947 / 2474 | 1830 / 2218 | Pior |
| 12 | 256 KiB | 300 / 0 | 300 / 0 (três repetições) | 1359 / 1659 | 982 / 1114 (1ª) | Empate em 503 |
| 20 | 64 KiB | 280 / 20 | 282 / 18 | 1536 / 1699 | 1780 / 2019 | Melhor por 2, isoladamente |
| 20 | 256 KiB | 300 / 0 | 289 / 11 | 1035 / 1151 | 1512 / 1649 | Pior |

**Resumo:** **3 configurações piores, 2 empatadas, 1 melhor** no número de 503. Runners e interleavings diferentes: a comparação NÃO é pareada deterministicamente no mesmo agendamento; P95/P99 não permitem atribuição causal. Não há melhora reproduzida com margem de segurança. Não ativar grupo=2.

**Pool 12, chunk 256KiB, grupo=2, 3 rodadas independentes:**
| Rodada | HTTP 200 | HTTP 503 | P95 ms | P99 ms |
|---:|---:|---:|---:|---:|
| 1 | 300 | 0 | 982.115 | 1114.420 |
| 2 | 300 | 0 | 972.608 | 1052.634 |
| 3 | 300 | 0 | 914.627 | 985.123 |

Em TODAS as 14 rodadas comerciais da matriz A/B (6 grupo 1, 5 grupo 2 simples, 3 grupo 2 repetidas), os contadores **`preheader_admission_denials=0`**. Os 503 residuais foram classificados como `IncompleteRead` do upstream após COMMIT de revisão, sem retry de HTTP 401 ou de corpo 200 parcial. Todos os HTTP 200 aceitos foram SHA-256 íntegros com 10.000 eventos originais sintéticos.

## Prova determinística de revogação e mudança comercial no candidato

Cada uma das seis configurações grupo=2 passou o teste real com PostgreSQL17, lock compartilhado e escritura concorrente exclusiva: dois cenários (`commercial`, `revoke`) por configuração. O writer não conseguiu contornar o lock, houve **0 novos bytes da aplicação após COMMIT** e nenhum timeout de pool. A transação verificou membership/revisão em cada bloco, incluindo RLS. O teste aceitou como legítimo um relatório antigo completo **inteiramente escrito antes do COMMIT**, ainda que seu buffer TCP seja consumido depois. Para 64KiB, esperou-se 200 truncado fail-closed; para 256KiB o grupo pode cobrir todo o relatório de ~352KiB, resultando em 200 completo pré-COMMIT.

**Tempos observados dos writers** nos seis jobs agrupados: comercial ~**35,15–37,93 ms**; revogação ~**33,26–35,68 ms**, incluindo atraso deliberado de ~30ms injetado pelo teste. Não são limites máximos nem SLA de revogação com 300 conexões; teste aborda um stream controlado por vez.

As provas de transporte com **dois processos no mesmo host** (não duas máquinas), FIN/RST/half-open, zero retries de 401/200 parcial, tickets expirados, atraso real de scheduler, RLS e buffer TCP foram reexecutadas: **300/300 HTTP 200 íntegros** em cada um dos 12 jobs independentes, mais **9 GETs negativos/recuperação** em cada job. A prova TCP já demonstrada segue válida: **32.783 bytes enviados pré-COMMIT podem chegar depois**, sem nova escrita da aplicação após COMMIT. O fechamento físico em 420ms NÃO foi comprovado.

## Instrumentação de custo e recurso, sem extrapolar indevidamente

- Comercial, 300 GETs por rodada na corrida + 200 GETs de recuperação e verificações diretas. **Gzip dos HTTP 200 completos da corrida** variou de ~**98,48 a 105,52 MB**; isso NÃO é egress total de cada job, pois exclui as respostas de recuperação, o overhead TCP/TLS e as tentativas negativas.
- Guardas SQL **instrumentados** na corrida comercial: aproximadamente **1.487–3.521** conforme chunk, concorrência e 503; são chamadas de validação, NÃO a contagem total de SQL statements, scans, faturamento ou WAL.
- DB sintético comercial na comparação: ~**21,94–22,02 MB** e índice de histórico original ~**9,81 MB**. O WAL comercial incremental **não foi isoladamente instrumentado** nesta comparação, portanto não declarar um valor para ele.
- WAL da fixture de transporte no job grupo=2/pool12/256KiB: **24.056 bytes** após carga inicial; prova TCP separada ~**4.480 bytes**. Não são WAL total nem mensal.
- RSS processo principal comercial no A/B: ~**199.384–262.028 KiB** nas configurações com 1 rodada; outros runners chegaram a valores distintos. Workers, PostgreSQL, kernel e page cache **não somados**; nenhum custo real de VM inferido.
- Teste de transporte local: **309 GETs / 300 completos por job**, ~**132,85 MB gzip** de corpo íntegro; números separados dos relatórios comerciais.
- Modelo aritmético restrito a **um relatório gzip de 351.751 bytes por cliente/dia × 30 dias**: **1,055253 GB para 100** e **3,165759 GB para 300**, sem mídia, cache, heartbeat, egress TLS, índices, armazenamento real ou retries. **Valores em R$, limites efetivos do Supabase Free e custos de 300 TVs NÃO foram medidos.**

## Decisão de segurança, disponibilidade e promoção

| Verificação | Resultado |
|---|---|
| 503 de TOCTOU na admissão inicial | **PASS**: zero em todas as rodadas |
| Integridade SHA-256, AES-GCM at rest, outbox, JSON original, RLS sintético | **PASS** nas suítes descartáveis |
| Revogação concurrente e COMMIT comercial com 2 blocos, sem escrita pós-COMMIT | **PASS** sob barreiras determinísticas testadas |
| Efeito de 2 blocos em reduzir 503 com 300 clientes | **FAIL como otimização**: pior em 3/6 configurações; não promover |
| Sem entrega TCP de bytes pré-COMMIT depois de revogação | **NÃO GARANTIDO**: tecnicamente refutado |
| Encerramento físico de streams em 420ms | **NÃO COMPROVADO** |
| Segurança/latência de revogação sob 300 streams agrupados e hosts físicos distribuídos | **NÃO COMPROVADO** |
| Custo em R$, SLA, capacidade 300 TVs e provider Free | **NÃO MEDIDOS / NO-GO** |

**Produção NO-GO. O recurso candidato é um toggle experimental no QA com default=1 e NÃO está implantado. Preserve versões históricas, branches de trabalho independentes e não faça deploy.**
