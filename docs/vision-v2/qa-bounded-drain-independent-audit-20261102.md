# Vision V2 — Revisão independente do bounded drain comercial

Data: 02/11/2026. Branch: experiment/vision-v2-sequence-watermark-qa-20261031.
Base preservada: 4be80b7276fc770b1b948608cbdc1ef3a9a8595b.
Código existente preservado: secure-pool-qa/qa.py com QA_STREAM_GUARD_GROUP=1 por padrão. A bancada drain_300.py já existia no commit base; não foi reescrita. Testes novos e nenhuma implantação.
**PRODUÇÃO NO-GO.**

## Evidência real de GitHub Actions

- [Matriz de 20 jobs em PG17 descartável — PASS 20/20](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41449543872): 6 configurações originais, 6 drain, 6 TCP multiprocesso FIN/RST/half-open e 2 AES-GCM/revogação midstream.
- [Prioridade de revogação — PASS 2/2](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41450010715): chunks 64 e 256 KiB; real PostgreSQL17 e HTTP 401, com contador de ativo sintético para barreira controlada.
- Commits novos: 23a00a879f2b0dcf8417c7fddc11c706a9c9aa4a (workflow de 20 testes), 5b6cbddb423147b319ef15f0b6da523060f897e4 (teste independente prioridade), 17ec328e8cd9e0cfd641fdc42fe1c9b54ae9b2ae (workflow adicional).
- Contas oficiais, produção, Supabase, TV, APK, painel, site e históricos reais não foram consultados nem modificados.

## Diagnóstico dos HTTP 503 e diferença entre resultado final e tentativas

A correção anterior do TOCTOU de admissão continua: lock advisory compartilhado adquirido ANTES de ler revisão comercial na mesma transação. Na matriz original, zero negativos pre-header; nos drenos o contador correspondente dos workers também ficou zero.

Um stream HTTP 200 já iniciado pode ser interrompido fail-closed após COMMIT comercial; o proxy detecta IncompleteRead e retorna HTTP 503, sem aceitar gzip/hash SHA-256 inválido. A bancada experimental já existente de drain de rota aguarda pedidos da rota antiga até um limite e pode responder HTTP 503 na admissão. O cliente faz retry SOMENTE de HTTP 503 para GET idempotente, sempre com novas verificações upstream, no máximo 5 tentativas e 7,5 segundos. NÃO repete 401 ou HTTP 200 truncado. Os HTTP 503 de proxy e de upstream não podem ser agregados como se todos fossem falhas de origem.

| Pool | Chunk | Original: 200/503 finais | Drain: 200/503 finais | 503 intermediários drain | Clientes com retry | P95 ms original/drain | P99 ms original/drain |
|---:|---:|---|---|---:|---:|---:|---:|
| 8 | 64KiB | 298/2 | 300/0 | 31 | 30 | 2600/2749 | 3667/3191 |
| 8 | 256KiB | 298/2 | 300/0 | 2 | 2 | 1625/1535 | 2098/1871 |
| 12 | 64KiB | 300/0 | 300/0 | 4 | 4 | 1772/1444 | 2039/1920 |
| 12 | 256KiB | 299/1 | 300/0 | 3 | 3 | 1691/1864 | 2464/2590 |
| 20 | 64KiB | 280/20 | 300/0 | 22 | 21 | 1362/2013 | 1523/2397 |
| 20 | 256KiB | 300/0 | 300/0 | 30 | 28 | 977/1500 | 1072/2061 |

**Somatório de seis ondas de drain:** 1.800 respostas HTTP 200 íntegras depois de retries, **92 HTTP 503 intermediários**, **88 clientes afetados** e ao menos **92 tentativas GET extras** comparado a uma tentativa por cliente (~5,1% na onda). Os contadores de recusa do proxy (97 no roteiro inteiro, incluindo outras ondas) possuem denominadores diferentes e não são somados. Em pool20/64KiB, por exemplo, o original tinha 20 abortos pós-header e o drain contou 22 intermediários, incluindo 21 admissões rejeitadas pelo proxy no roteiro e um aborto pós-header no upstream. Isto pode deslocar o erro em vez de eliminá-lo.

Os seis drenos reportaram 0 timeout lógico; duas trocas por job tiveram esperas de 73–447ms. **O valor observado de 447ms já excede o limite nominal 420ms**: não alegar garantia de encerramento físico ou duração absoluta. Os jobs executaram em runners separados, não pareados deterministicamente; latências e diferenças não demonstram causalidade nem disponibilidade garantida.

## Integridade, revogação e transporte

- Os relatórios completos são gzip + SHA-256 originais com 10.000 eventos sintéticos e revisão válida. Nos testes de falhas, AES-GCM, materialização selada, arquivos alterados/symlink, crash/replay e membership foram verificados; zero novas escritas da aplicação após commit real de revogação ou alteração comercial.
- Nos testes reais de transporte, **6/6 PASS**, 300/300 HTTP 200 completos e 309 GETs locais por job, dois processos no mesmo host, FIN/RST/half-open, HEAD/Content-Length parcial e epoch. Não são dois hosts físicos.
- Teste especial 2/2 PASS: uma rota com contador de pedido antigo artificialmente retido bloqueava drain_switch, mas a transação REAL PostgreSQL de revogação confirmou enquanto a espera continuava (6,856–9,932 ms). HTTP novo e real de JWT revogado recebeu 401 **uma única vez**, sem corpo, e o regrant permitiu HTTP 200 íntegro. O contador ativo desse teste é **sintético**, não uma conexão TCP real. Os testes de revogação TCP real são separados nos jobs de falhas.
- Bytes anteriormente enviados podem continuar chegando após COMMIT por buffers TCP. A política impede novas escritas de aplicação pós-COMMIT nos testes, NÃO reverte buffers preexistentes nem promete fechamento físico em 420ms.

## SQL, WAL, RSS, GETs, egress e projeções

- SQL guardas por onda: original **1.505–3.521**, drain **1.512–3.551** aproximadamente; não são todos os statements do PostgreSQL ou cobrança. Timeouts de pool: zero em todas as 12 ondas.
- WAL no roteiro drain medido após a fixture comercial: **213.824–217.440 bytes**; original não possui instrumentação WAL equivalente, portanto não calcular diferença. Em um dos testes de transporte: 215.776 bytes (fixture distinta).
- Banco PG sintético comercial: ~21,99–22,00 MB; índice playback_logs ~9,81 MB. RSS processo principal entre 202.772–266.176 KiB, workers ~66–68 MiB cada. Sem somatório de PostgreSQL, workers, kernel e cache do sistema.
- Egress gzip dos HTTP 200 da onda comercial: ~98,48–105,52 MB por configuração; exclui outras ondas HTTP, overhead e tentativas rejeitadas. Transporte: 132.847.500 bytes gzip por job. GETs da onda comercial: 300 no original, pelo menos 300 + retries no drain, além de 200 GETs pós-replay e outras verificações. Não são métricas do Supabase oficial.
- Modelo restrito a um relatório gzip de 351.751 bytes por cliente/dia durante 30 dias: **1,055253 GB para 100**, **3,165759 GB para 300** (GB decimais); sem imagens, vídeos, heartbeats, armazenamento, TLS, retransmissões, índices ou custos de execução. **Custos reais em R$, Supabase Free e capacidade de 300 TVs NÃO medidos.**

## PASS/FAIL e decisão

| Aspecto | Resultado |
|---|---|
| 20 + 2 jobs PG17 isolados, logs reais | **PASS 22/22** |
| 503 admissão antes de bloqueio da revisão | **PASS: 0 regressões observadas** |
| Integridade relatório SHA-256, AES-GCM, RLS, outbox, TCP e sem retries de 401/200 parcial | **PASS dentro do escopo sintético** |
| 300 respostas completas finais em cada drain | **PASS com retries controlados** |
| Redução de 503 emitidos no proxy/origem e de GETs totais | **NÃO PROVADO**: 92 falhas intermediárias, GETs extras |
| Revogação sem esperar gate sob contador ativo artificial, HTTP real 401 | **PASS limitado** |
| Dois hosts, limite físico 420ms, política global entre múltiplos proxies | **NÃO PROVADO / NO-GO** |
| Custos monetários reais, Supabase Free e disponibilidade de 300 TVs reais | **NÃO MEDIDOS / NO-GO** |

**Não ativar drain como padrão, não promover o agrupamento de dois blocos, não publicar em produção. Manter uma só janela de autorização por bloco, QA_STREAM_GUARD_GROUP=1. Preservar toda a história de commits e artefatos; produção NO-GO.**
