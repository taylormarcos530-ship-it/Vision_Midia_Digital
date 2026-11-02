# Vision V2 — Auditoria adversarial independente do harness causal
Data: 02/11/2026. Branch exclusiva: experiment/vision-v2-sequence-watermark-qa-20261031.
Base original: e71b3175586d7b38e2765c6b1182e4b5bc562fa1.
Código QA testado: 62de677e1a514df2957fdbe41e6dcc93df46dab2.
**Produção NO-GO.** Streaming original permanece QA_STREAM_GUARD_GROUP=1. Drain não habilitado. Nenhum acesso ou alteração ao Supabase oficial, APKs, site, painel, TVs, históricos reais ou branch main.

## Provas realmente executadas
- [Auditoria independente A — 6/6 PASS, commit 62de677e](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41486531667): pools totais 8/12/20 × chunks 64/256KiB, PG17 descartável em cada job. 300 GETs íntegros, RLS negativo, duas instâncias de proxy HTTP e **duas origens HTTP TCP diferentes**, revogação concorrente à mudança real de rota sob gate PostgreSQL, RST, half-open, atrasos de scheduler, bytes preservados por tentativa. Seis artefatos JSON.
- [Harness causal B — 6/6 PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41486531666): 319 GETs por configuração, seis artefatos JSON com cada tentativa e bytes descartados.
- [Regressões do streaming comercial C — 14/14 PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41485805100): 6 corridas comerciais 300 clientes, 6 transportes HTTP reais multiprocesso e 2 falhas AES-GCM/outbox/revogação. Esses jobs executaram em commit de CI anterior à última alteração do harness causal; código comercial original permaneceu intacto.
- [Auditoria intermediária dos bytes](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41485961139): 6/6 PASS adicionais, preservados como regressão histórica; não incluídos no total principal.
**Total de jobs finais independentes nos três conjuntos A/B/C: 26/26 PASS, zero FAIL residuais.**

## Problemas concretos encontrados e corrigidos SOMENTE no harness de QA
1. Pools SQL anteriormente compartilhados por origem e ambos os proxies. Agora existem pools separados origin / proxy_0 / proxy_1, conexões/backend PIDs distintos, respeitando orçamento TOTAL: pool 8 = 4+2+2, pool 12 = 6+3+3, pool 20 = 10+5+5. Nenhum pool ultrapassou capacidade e todos ficaram sem conexões emprestadas após o teste.
2. HTTPResponse.read(n) ocultava bytes parcialmente recebidos ao lançar timeout no meio do bloco. A leitura foi substituída por read1 incremental. Cada entrada do ledger inclui ledger_id único sequencial, corpo entregue ao cliente e upstream_discarded_bytes. O contador agregado de bytes descartados iguala a soma por tentativa; erros ao cliente não são classificados como HTTP 200 válidos.
3. Tratamento separado de RST antes de headers (upstream_reset), timeout/half-open (upstream_timeout), HTTP 200 incompleto (upstream_incomplete), 503 explícito da origem, 503 local do proxy e 503 pelo gate PostgreSQL. Nenhum 401, RST, HTTP 200 truncado ou timeout foi repetido.
4. A prova de mudança de rota usa dois servidores HTTP de origem reais, não só um booleano. Durante o streaming de uma resposta antiga, duas threads iniciadas por barreira alteraram gate/rota e revogaram membership em transações PG independentes. Ambos os proxies trocaram para a nova origem; a segunda origem recebeu quatro GETs HTTP depois do cutover, 401 durante revogação e 200 íntegros após regrant. O stream antigo foi interrompido sem novas escritas da aplicação depois do COMMIT.
5. FORCE RLS foi auditado com relrowsecurity=true e relforcerowsecurity=true, role leitora sem superuser nem bypassrls, tenant errado retornando zero registros, tentativa de row_security=off bloqueada e UPDATE pela role leitora negado. Membership não foi modificado no teste negativo.
6. Relógio: simulações de parede em -24h e +24h; scheduler realmente atrasado em torno de 55ms para prazo monotônico de 25ms, rejeitado após exceder em ~30ms. Não houve alteração do relógio físico do runner, JWT de produção nem prazo físico global de 420ms.

## Auditoria dos 319 registros HTTP (conjunto B)
Cada configuração possui 319 tentativas físicas de HTTP GET, numeradas 1 a 319, sem retry. 304 respostas completas HTTP 200 de 442.930 bytes gzip por relatório, 4×401 e 11×503 injetados (proxy_local 2, proxy_gate 2, upstream_http 2, upstream_timeout 2, upstream_incomplete 3). **Bytes de corpos efetivamente recebidos pelos clientes: 134.650.720 por configuração.** Erros retornados pelo proxy tiveram corpo zero.

Separadamente, o proxy recebeu e descartou bytes enviados pelo upstream em HTTP 200 inválidos: **79.536 bytes em chunk 64KiB** (2×7.000 de FIN + 65.536 da revogação) ou **276.144 bytes em chunk 256KiB** (14.000 + 262.144). Cada descarte consta no ledger individual. Isto não prova entrega física de buffers TCP após o COMMIT nem egress externo faturado.

## Auditoria adversarial independente (conjunto A)
Cada job fez **311 tentativas**: 302 HTTP 200 completos (300 da onda principal e 2 após regrant), 2×401, 2×503 de gate, 2×503 RST, 2×503 timeout half-open e 1×503 por revogação midstream. Corpo completo entregue ao cliente: **133.764.860 bytes** (302×442.930); mais 79.536/276.144 bytes recebidos do upstream e descartados. A origem escreveu 133.844.396/134.041.004 bytes na aplicação, respectivamente; igualdade apenas ao nível da instrumentação de aplicação.

| Pool | Bloco | P95 ms | P99 ms | SQL guards | WAL pós-fixture bytes | RSS Python KiB | Bytes descartados |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 | 64KiB | 1970.758 | 2728.355 | 2736 | 243320 | 111428 | 79536 |
| 8 | 256KiB | 2017.743 | 2791.999 | 1226 | 243376 | 121324 | 276144 |
| 12 | 64KiB | 2907.612 | 3799.476 | 2736 | 243376 | 115196 | 79536 |
| 12 | 256KiB | 2017.382 | 2630.677 | 1226 | 243320 | 123648 | 276144 |
| 20 | 64KiB | 2152.979 | 2779.064 | 2736 | 243376 | 117664 | 79536 |
| 20 | 256KiB | 1659.832 | 2619.873 | 1226 | 243320 | 129232 | 276144 |

P95/P99 correspondem somente à onda normal com 300 GETs, não aos 11 negativos. SQL são apenas verificações instrumentadas, não todos statements. WAL incremental da pequena fixture PostgreSQL17, DB ~7.788.211 bytes, índice membership 16.384 bytes. RSS apenas Python, não soma PG/kernel/cache. Commit gate/revogação ~8–19ms nas barreiras simuladas: NÃO é SLA real. Os servidores de origem e os dois proxies rodam no MESMO PROCESSO e MESMO RUNNER; não comprova múltiplas máquinas/hosts.

## Regressão comercial original
Seis corridas comerciais com zero erro TOCTOU na admissão e nenhum HTTP 200 inválido aceito. Os 503 fail-closed pós-header persistem: pool 8 (64KiB: 3; 256KiB: 3); pool 12 (64KiB: 12; 256KiB: 0); pool 20 (64KiB: 13; 256KiB: 17). O código de produção não foi modificado para reduzir esses 503. Seis transportes multiprocessos executaram 300 HTTP 200 íntegros cada e 309 GETs locais por job, com FIN/RST/half-open. Dois jobs faults verificaram AES-GCM, memfd selado, recuperação via outbox e revogação durante HTTP sem novas escritas pós-COMMIT. **PASS de integridade não é PASS de disponibilidade em 300 TVs reais.**

## Custos/modelo, limites e decisão
Modelo estrito de UM relatório por cliente por dia × 30 dias, sem mídia, TLS, retries, heartbeat, armazenamento ou WAL mensal: fixture causal de 442.930 bytes gzip => 1,328790 GB/100 clientes e 3,986370 GB/300; fixture comercial original de ~351.751 bytes gzip => 1,055253 GB/100 e 3,165759 GB/300. **Não existe aqui custo medido em R$, capacidade comprovada do Supabase Free ou previsão validada para 300 TVs reais.**

| Critério | Resultado |
|---|---|
| PG17 descartável A/B/C, provas independentes e regressão original | PASS 26/26 |
| FORCE RLS, privilégios, dois pools proxy isolados da origem | PASS local |
| 319 GETs completos com ledger único e bytes descartados por tentativa | PASS 6/6 |
| RST/half-open, interrupção de 200, nenhuma repetição de 401/200 parcial | PASS 6/6 |
| Mudança para segunda origem HTTP simultânea à revogação | PASS somente mesmo processo/runner |
| Atraso real de agendamento e relógio de parede simulado ±24h | PASS limitado à injeção sintética |
| Redução comprovada de HTTP 503 do comercial original | NÃO: nenhuma alteração de disponibilidade feita |
| Dois hosts físicos, término de TCP em 420ms, JWT/KMS oficial | NÃO COMPROVADO |
| Valor em reais, plano Free/300 TVs reais | NÃO MEDIDO |

**NO-GO de produção. Não ativar drain nem 2 blocos, não aplicar mudanças a sites, APIs, APKs, Supabase ou TVs. Preserve todos os commits e relatórios.**
