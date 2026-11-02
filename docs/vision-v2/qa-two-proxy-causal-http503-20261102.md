# Vision V2 — Auditoria causal HTTP 503, dois proxies locais e PostgreSQL 17

**Data:** 02/11/2026. **Branch:** experiment/vision-v2-sequence-watermark-qa-20261031.
**Base histórica preservada:** c2c6a24b4f074bb8d6989028074bc7dda7d872b2.
**Estado:** testes isolados PASS; **produção NO-GO**. O valor padrão QA_STREAM_GUARD_GROUP=1 foi mantido e o drain experimental NÃO foi ativado.

## Fontes verificáveis e histórico das falhas

- [Execução causal inicial 41470085382](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41470085382): **6/6 FAIL do harness**. Falha reproduzida: variável local start (float) sombreou fábrica start() que inicia servidor HTTP. Não foi bug comercial nem validação SQL reprovada. O FAIL foi preservado.
- Correção isolada do harness: commit 69c73ec2c0b6d51c270dd7e7ebeb57154dc69f26.
- [Execução causal final 41470696869](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41470696869): **6/6 PASS** contra a versão corrigida; **6 artefatos**, cada qual com qa-causal-ledger.json contendo TODOS os 319 registros individuais de HTTP GET, status, origem, bytes do corpo, duração, identificação de instância e ausência de retry.
- [Regressões originais 41470269579](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41470269579): **14/14 PASS** no commit 4b2fe23caf5f01d1c1cdacdad46edec2e4969729. Seis testes mistos comerciais, seis de transporte multiprocesso e dois de falhas/AES-GCM/revogação no PostgreSQL 17 descartável.
- [Revogação prioritária 41471019693](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41471019693): **2/2 PASS**, chunks 64/256KiB no código preexistente sem ativar o drain por padrão.
- A execução causal corrigida 41470177008 foi observada em queued sem jobs e uma nova execução 41470696869 obteve os resultados efetivamente medidos. Não converter queued em PASS. Os resultados finais são apenas os trabalhos que realmente executaram.

**Total de jobs distintos validados nesta etapa:** 14 regressões + 6 causais + 2 prioridades = **22/22 PASS**. As seis falhas de harness anteriores não são apagadas nem agregadas a esse total de regressão corrigida.

## Topologia e definição dos limites

A bancada causal nova instala **um servidor HTTP de origem e dois servidores HTTP proxy reais** usando sockets loopback 127.0.0.1, **os três no MESMO processo Python, MESMO runner**. Os proxies não compartilham um gate Python; ambos consultam a mesma tabela de coordenação sob lock advisory transacional no PostgreSQL 17 local para bloquear/liberar admissão. Separadamente, FORCE RLS e papel qa_causal_reader verificam membership na origem por bloco do gzip. Um bloqueio global da rota foi visto nas duas instâncias; revogação de associação do usuário confirmou separadamente da rota e foi percebida nos dois proxies. Isso **não testa múltiplos hosts, regiões, falha de rede entre proxies, leader election real nem JWT/JWKS de produção**. O token é sintético.

O streaming continua com **um lock transacional compartilhado por bloco**. Nenhum 200 gzip truncado recebe sucesso; 401 não é repetido. O teste de revogação midstream retém a origem após primeiro bloco, confirma o COMMIT de exclusão, solta a barreira e comprova **zero novas escritas de aplicação depois do COMMIT**. Pode haver recepção tardia de bytes gravados ANTES dele.

## Classificação determinística de erros por 319 GETs / configuração

Os seis testes causais usam **300 GETs normais concorrentes sem injeção** (150 por proxy; 300/300 íntegros) e 19 GETs de fault/revogação/restauração, **319 tentativas por configuração**, todas com tentativa=1, nenhum retry.

| Classificação HTTP real | Contagem por configuração |
|---|---:|
| 200 completo, SHA-256 de 10.000 eventos original sintético | 304 (300 na onda principal + 4 de recuperação) |
| 401 revogação, sem corpo e sem retry | 4 |
| 503 local do proxy forçado | 2 |
| 503 gate global PostgreSQL indisponibilizando admissão em ambos proxies | 2 |
| 503 explícito retornado pelo upstream | 2 |
| 503 por timeout do upstream | 2 |
| 503 por FIN / HTTP 200 incompleto da origem | 2 |
| 503 por revogação após 1º bloco (200 upstream incompleto) | 1 |
| **TOTAL** | **319** |

Consequentemente **11 HTTP 503 e 4 HTTP 401 por configuração foram propositalmente INJETADOS**, e 304 respostas HTTP 200 foram corretamente entregues. A injeção não é um benchmark de taxa espontânea de erro em produção. O resultado se deve à causalidade controlada por endpoint e a contadores explícitos; não houve melhora aplicada no player. Os seis testes independentes confirmaram o mesmo vetor causal.

## Métricas reais da onda de 300 GETs normais

| Pool SQL | Chunk | HTTP 200 íntegros | P95 ms | P99 ms | Guardas SQL na execução TOTAL | WAL bytes após fixture | RSS Python KiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 | 64KiB | 300 | 2264.432 | 3604.000 | 2762 | 243624 | 111948 |
| 8 | 256KiB | 300 | 1491.776 | 1827.129 | 1242 | 243544 | 120232 |
| 12 | 64KiB | 300 | 1447.719 | 1848.133 | 2762 | 243544 | 113316 |
| 12 | 256KiB | 300 | 1641.998 | 2151.851 | 1242 | 8192 | 130684 |
| 20 | 64KiB | 300 | 1623.259 | 1995.789 | 2762 | 243624 | 120232 |
| 20 | 256KiB | 300 | 1750.316 | 2200.320 | 1242 | 243624 | 134468 |

P95/P99 são calculados apenas sobre 300 GETs normais, não sobre as falhas e retries. Os **guardas SQL** na tabela incluem checagens de gate dos proxies e membership da origem e do corpo. Não são todos os statements. O WAL incremental inicia depois da instalação da fixture, e varia com checkpoints/flush e runner; a observação isolada de 8192 bytes não constitui custo garantido. **Pool SQL nunca excedeu 8, 12, ou 20**, conforme job. Banco da pequena fixture causal: 7.788.211 bytes e índice de membership: 16.384 bytes; não confundir com banco comercial original (~22 MB e índice playback_logs ~9,8 MB). RSS é só do processo Python local com 3 servidores; PostgreSQL, kernel e page cache não são incluídos.

**Contabilidade de bytes exata por tentativa (em qa-causal-ledger.json):** as 319 respostas de cada job somaram **134.650.720 bytes de corpo recebidos**, sendo 304 respostas gzip completas de **442.930 bytes cada** e 15 respostas de erro sem corpo. Isso não inclui cabeçalhos HTTP, TCP/TLS nem dados de falhas parciais do upstream que o proxy recusou. O backend escreveu ~134.730.256 bytes (chunk 64KiB) ou 134.926.864 bytes (256KiB) antes de contabilizar falhas/aborto; é tráfego da fixture local, não egress faturado.

A antiga fixture comercial usa outro gzip com ~351.751 bytes por relatório e já tinha projeção aritmética de **1,055253 GB / 100 clientes / 30 dias** e **3,165759 GB / 300 clientes / 30 dias** (um relatório por dia). A nova fixture de 442.930 bytes produziria **1,328790 GB / 100 / 30 dias** e **3,986370 GB / 300 / 30 dias** na MESMA hipótese, apenas corpo gzip. Esses números são modelos, **não preços ou uso do Supabase oficial**. Não incluem vídeos, imagens, heartbeats, queries, retransmissões, TLS, backups ou retenção.

## Regressão do sistema comercial original, não o benchmark simplificado

Os seis jobs reais de corrida comercial original preservaram a correção de admissão: **0 revision_preheader_denials**. Sob COMMIT comercial concorrente, ainda houve HTTP 503 fail-closed legítimos, atribuídos a upstream IncompleteRead: pool8/64KiB **1**, pool8/256KiB **0**, pool12/64KiB **3**, pool12/256KiB **0**, pool20/64KiB **2**, pool20/256KiB **17**. Resultados de execuções isoladas dependem do interleaving; não afirmar taxa estacionária. Nenhum HTTP 200 incompleto passou SHA-256. As seis execuções do transporte multiprocesso (dois processos no mesmo host, diferentes dos dois proxies de um processo) tiveram **300/300 200**, 309 GETs locais em cada, incluindo FIN/RST/half-open e buffer precommit. Ambos os jobs de faults.py validaram **AES-GCM, memfd selado, outbox e revogação midstream**, com zero nova escrita após commit, sob 64/256KiB.

## Prioridade da revogação durante o drain não habilitado

A prova preexistente foi reexecutada sem alterar ou ativar o drain do produto. Um contador de requisição ativa **sintético** retinha o drain_switch no proxy; a transação **real** de revogação no PostgreSQL confirmou enquanto o drain aguardava: **10,191ms em 64KiB e 12,246ms em 256KiB**. O próximo GET HTTP real recebeu **401 uma vez, sem corpo**, e a associação restaurada voltou a gerar HTTP 200 completo com SHA-256. A prova NÃO equivale a 300 streams reais presos em dois hosts ou encerramento físico rígido em 420ms.

## Veredito

| Requisito | Estado |
|---|---|
| Retomar apenas branch experimental e manter default grupo 1 | PASS |
| Dois HTTP proxies no mesmo processo coordenados em PG17 descartável | PASS, escopo local |
| Classificação separada de 503 proxy/gate/upstream/timeout/truncamento | PASS, injeção determinística |
| 319 tentativas e bytes de TODAS as respostas por job em JSON | PASS, 6 artefatos |
| 300 GETs completos com SHA-256 / 10.000 eventos sintéticos por configuração | PASS 6/6 |
| 401 e 200 truncado nunca repetidos; no postcommit app bytes | PASS na bancada local |
| Regressoes original mixed, transporte real, AES-GCM e outbox | PASS 14/14 |
| Revogação prioritária durante drain controlado | PASS 2/2, contador antigo sintético |
| Provada diminuição real dos 503 do sistema original | NÃO: **zero mudanças em lógica de produção; falhas causais injetadas** |
| Coordenação realmente entre hosts físicos ou hard 420ms TCP close | NÃO VALIDADO |
| Preço real em reais, Supabase Free, 300 TVs operando em produção | NÃO MEDIDO |

**Resultado de QA:** 22/22 jobs de versões corrigidas comprovados, preservando explicitamente 6 FAILs iniciais de código do teste. Sem alterar Supabase oficial, Vercel, APK, site, painel, TVs, históricos ou main. **PRODUÇÃO NO-GO.**
