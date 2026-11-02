# Vision V2 — Revisão adversarial independente: PostgreSQL 17 / 300 clientes / TCP bufferizado

**Data local:** 01/11/2026 (execuções GitHub Actions concluídas em 02/11/2026 UTC).
**Branch isolada:** `experiment/vision-v2-sequence-watermark-qa-20261031`.
**Base preservada:** `fb95f602d437ae7f6a67d41c4395c1ccb3e47c3a`.
**SHA de código final testado:** `bdd3a3c8c21ecde1035b245afc6e81acd7bfbd30`.
**Resultado:** **7/7 PASS na nova matriz (mais 1/1 PASS sequência/offline). PRODUÇÃO NO-GO**.

## Evidências originais — não omitir os FAIL

- [Primeira execução 41368692605](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41368692605): **6 PASS / 1 FAIL**. Na segunda repetição, o banco tinha sido recriado mas as roles globais sintéticas `authenticated` e `anon` persistiam no CLUSTER PostgreSQL, gerando `psycopg.errors.DuplicateObject`. **FAIL de isolamento da fixture**; não foi um 503 real ou falha no Supabase.
- [Execução corrigida 41368878471](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41368878471): **7/7 PASS**; há logs e artefatos ZIP separados por configuração. Cada job executa banco `vision_v2_quarantine_disposable` exclusivamente em localhost, numa instância descartável de PostgreSQL 17.
- [Sequência/offline 41368878541](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41368878541): **1/1 PASS**.
- Commit de adição da suíte `de693bf3ae9fcdb80850a8cf8c0003b817ced4e2`; correção da fixture, **somente QA**, `bdd3a3c8c21ecde1035b245afc6e81acd7bfbd30`. Nenhuma alteração do código de aplicação, telas, edge functions ou produção.

## Classificação de 503: dois tipos que não podem ser confundidos

**503 evitável antes dos cabeçalhos:** no problema anterior, a leitura da revisão comercial precedia o lock advisory, permitindo COMMIT no meio. A correção preservada adquire o lock **antes** de ler a revisão na mesma transação. Na matriz atual, `admission_preheader_revision_denials=0` em **todas as 9 rodadas comerciais** (seis configurações + três repetições).

**503 fail-closed de um HTTP 200 iniciado:** após a revisão comercial mudar, um stream in-flight anteriormente autorizado pode ser abortado. O proxy recebe `IncompleteRead` no upstream e retorna **503 sem tratar HTTP 200 truncado como sucesso**. Não há retry automático de 401 ou HTTP 200 incompleto. Esses casos não são prova de disponibilidade de 100%. `postheader_revocation_aborts` no JSON refere-se à **mudança de revisão comercial**, não necessariamente à revogação de associação de usuário.

| Pool por worker | Chunk KiB | HTTP 200 íntegros/300 | HTTP 503 fail-closed | Negativas pré-header | P95 ms | P99 ms | Guardas SQL instrumentados | Gzip comercial íntegro MB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 | 64 | 299 | 1 | 0 | 1389.212 | 1903.402 | 3515 | 105.167 |
| 8 | 256 | 297 | 3 | 0 | 1575.890 | 2299.962 | 1506 | 104.463 |
| 12 | 64 | 300 | 0 | 0 | 1460.672 | 1727.015 | 3521 | 105.519 |
| 12 | 256 | 294 | 6 | 0 | 1465.823 | 1779.840 | 1499 | 103.408 |
| 20 | 64 | 280 | 20 | 0 | 1240.767 | 1449.480 | 3434 | 98.484 |
| 20 | 256 | 280 | 20 | 0 | 1491.382 | 1704.184 | 1475 | 98.484 |

**Três repetições controladas, mesmo pool 12/chunk 256KiB** (outros runners/cadências não são um benchmark comparativo causal):
| Repetição | HTTP 200 | HTTP 503 `IncompleteRead` | Negativas pré-header | P95 ms | P99 ms | Guardas SQL |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 298 | 2 | 0 | 1298.035 | 1490.944 | 1505 |
| 2 | 298 | 2 | 0 | 1341.559 | 1521.661 | 1507 |
| 3 | 300 | 0 | 0 | 1356.731 | 1774.794 | 1509 |

**Critério de classificação:** todos os 503 nas nove rodadas comerciais foram identificados como `IncompleteRead` de upstream, e houve um aborto de stream pós-header correspondente em cada caso; **zero timeouts de pool**. Nenhuma resposta incompleta foi declarada HTTP 200 íntegra. Report original usa 10.000 eventos **sintéticos**, hash SHA-256 e reconstrução depois do outbox com AES-GCM, não dados comerciais reais.

## Transporte, relógio, dois processos e revogação

A suíte adversarial chama a bancada multiprocesso existente para cada um dos sete jobs (todos com **300 GETs íntegros/300**, além de 9 GETs negativos/recuperação: **309 tentativas locais por job**). Em **dois processos diferentes no MESMO runner físico**, testa:
- tickets de admissão emitidos antes do cutover: zero admissões antigas depois da troca, mesmo com agendamento real ~140ms além de deadline nominal de 420ms;
- cabeçalho 200 sem corpo, FIN depois de bloco, RST real e half-open: detecção de resposta incompleta em uma tentativa, **sem retry**;
- JWT/token sintético inválido: HTTP 401 em uma tentativa sem body; HTTP 503 transitório em GET idempotente: recuperação apenas na segunda tentativa;
- revogação real na fixture de associação PostgreSQL com FORCE RLS e advisory locks: **zero novas escritas de aplicação** depois do COMMIT e nova requisição HTTP 401 sem retry;
- chunks de 64/256 KiB e pools 8/12/20, sem 300 conexões SQL simultâneas.

**Nova prova independente de TCP pré-bufferizado:** uma thread envia **32.783 bytes de corpo ANTES** de uma transação PostgreSQL de revogação. O cliente intencionalmente **não lê nada até DEPOIS do COMMIT**: recebe os 32.783 bytes previamente enfileirados, mas o Content-Length 200 permanece incompleto e `IncompleteRead` rejeita o documento; **zero novas escritas da aplicação após COMMIT**. Esta prova usa tabela/lock local próprios; a verificação de FORCE RLS é separada na bancada de transporte. A entrega tardia pelo kernel/TCP não é proibida ou fisicamente reversível.

**FAIL/NO-GO de prazo rígido:** 420ms não garantem encerramento físico de sockets/streams; processos escalonados tardiamente ainda podem finalizar depois. A decisão de admissão e o fechamento físico são propriedades diferentes.

## Instrumentação: evitar números de faturamento fictícios

- Transporte, cada um dos sete jobs: **309 GETs locais**, **300 HTTP 200 íntegros**, **132.847.500 bytes gzip** só desses relatórios sintéticos; chamadas de guarda SQL de admissão/blocos **lower bound de 2.400 por 64KiB ou 900 por 256KiB**; WAL da fixture após inicialização reportado como ~**30.168 bytes** nos logs; P95/P99 variáveis por runner.
- Comercial, cada rodada: **300 GETs da corrida sob alteração**, mais **200 GETs íntegros de pós-replay** e **3 verificações diretas/iniciais** (total lógico de 503 GETs HTTP no roteiro, excluindo controle/outbox). A tabela comercial acima inclui apenas gzip dos HTTP 200 completos da corrida de 300, **não todo egress dessas verificações adicionais**.
- Banco PostgreSQL comercial: **21.943.987 a 22.058.675 bytes** conforme a rodada; índice original `playback_logs`: **9.805.824 bytes**. WAL incremental **comercial** não foi recontabilizado por esta nova suíte; **não inventar o número**. Prova de buffer separada: WAL após setup ~**4.504 bytes**, banco ~7.706.291 bytes; não é o banco comercial.
- RSS somente do processo principal comercial: **194.036–284.500 KiB** nos seis jobs da matriz; os dois workers (~65–68MiB cada), PostgreSQL e kernel **não estão incluídos** nesse valor. Em nenhuma rodada a soma de todos os processos foi medida.
- Contagens SQL acima são **instrumentação dos guardas**, NÃO todos os statements, scans, WAL, RLS, outbox ou billing.
- Projeção **exclusivamente aritmética** com um relatório original de referência de 351.751 bytes gzip por cliente/dia e 30 dias: **1,055253 GB para 100 clientes** e **3,165759 GB para 300 clientes** (GB decimais). Não inclui imagens, vídeos, mídia, heartbeat, HTTP negativos, overhead TCP/TLS, storage/retention ou preços.
- **Custos reais em R$, Supabase Free, egress/GETs de mídia real e operação de 100/300 TVs: NÃO MEDIDOS**.

## Resultado PASS / FAIL e decisão

| Requisito | Veredito |
|---|---|
| Correção de 503 por leitura de revisão antes do advisory lock | **PASS** em 9 rodadas: 0 negativas pré-header |
| HTTP 200 íntegro com SHA-256 e 300 clientes por configuração sem mutação | **PASS** na bancada de transporte |
| 300/300 HTTP 200 comerciais durante qualquer cutover/COMMIT/rollback | **FAIL como garantia geral**: houve até 20 fail-closed 503/300 |
| FIN/RST/half-open/200 truncado/401 sem retry; RLS sintético e revogação | **PASS** na bancada local |
| Zero novos bytes de aplicação escritos depois do commit de revogação | **PASS** em escritores cooperantes dos testes |
| Zero bytes previamente enfileirados recebidos depois do commit | **NÃO É VERDADE**: prova de entrega pós-commit de 32.783 bytes pré-commit |
| Encerramento físico de todos os streams em 420ms | **NÃO COMPROVADO / NO-GO** |
| Manifests, outbox, AES-GCM e relatórios originais | **PASS** nas regressões isoladas; KMS remoto real NÃO testado |
| Dois hosts/regiões/TLS real/JWT-JWKS oficial/Supabase real/APKs/TVs | **NÃO TESTADO / NO-GO** |
| Custo monetário e capacidade de 300 TVs/limites Free | **NÃO COMPROVADO / NO-GO** |

**Nenhum Supabase oficial foi consultado, nenhuma migration/deploy/APK/TV/site/painel/histórico real alterado. Testes e commits limitados à branch experimental. Não promover nem fazer deploy. PRODUÇÃO NO-GO.**
