# Vision V2 — PostgreSQL 17: 503 de admissão corrigido, validação independente e produção NO-GO
**Data:** 01/11/2026. **Branch exclusiva:** `experiment/vision-v2-sequence-watermark-qa-20261031`.
**Base preservada:** `d8f3399ec6adbc5eb50805dd8eca496fc3807a1f`. **Código final testado:** `2fd1e841b5e6d3d49be12494a9f10b0768c1fa36`.
**Somente PostgreSQL 17 descartável, dados e chaves sintéticos. Zero consulta ao Supabase oficial. PRODUÇÃO NO-GO.**

## Causa raiz confirmada em logs reais
A admissão em `secure-pool-qa/qa.py` lia a revisão comercial **antes** de adquirir o advisory lock compartilhado. O publicador concorrente adquiria lock exclusivo e podia COMMIT entre a leitura e `txguard(db, ..., revision)`. Isso disparava `PermissionError('revised_during_stream')` **antes dos headers** e resposta HTTP 503 a clientes ainda autorizados. Nos logs originais de 300 clientes:
- rodada antiga: **293 HTTP 200, 7 HTTP 503**, `denied=7`, `stale=0`, `pool.timeouts=0`;
- recheck pré-fix: **291 HTTP 200, 9 HTTP 503**, `denied=9`, `stale=0`, `pool.timeouts=0`;
- nenhuma prova de saturação, falha AES, timeout de pool ou revogação de associação nessas nove negativas.

**Correção de código mínima:** `txguard(db, claims, company)` adquire lock cooperativo e valida usuário/associação na transação **antes** do `SELECT revision`. O COMMIT comercial exclusivo não pode intercalar entre lock e observação da revisão. O guarda SQL por bloco continua validando revisão e associação: revogação **durante** stream ainda encerra transmissão, sem repetir um HTTP 200 truncado ou HTTP 401.

**Commits (todos experimentais):**
- `cb39b5ce93ededb5b6a65582e332296b7f5a4e35`: corrige ordem lock/leitura;
- `ce2d19b048e2337012b3de569e1f0fead5e4c058`: adiciona teste exigente para 503 de admissão;
- `7fe4c62f5126e04b037fde747bc28a710b03e573`: diferencia negativas pré-header de abortos pós-header e introduz diagnóstico de proxy;
- `2fd1e841b5e6d3d49be12494a9f10b0768c1fa36`: instrumenta a classe **efetivamente utilizada** de proxy comercial no driver, sem alterar produção.

## Falhas intermediárias preservadas, NÃO contadas como PASS
- [41362844975](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41362844975): FAIL porque a antiga asserção exigia uma falha durante mutação; obteve **300/300 HTTP 200, zero 503** após a correção.
- [41362867756](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41362867756): FAIL sob critério `zero 503` com **299 HTTP 200, 1 HTTP 503** residual. O log mostrou revisão mudando durante stream; não é a mesma janela pré-header. O proxy deve rejeitar 200 incompleto (sem retry).
- [41363147451, execução original](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41363147451): FAIL do teste de instrumentação: o contador foi colocado em `staged.py`, mas `mixed_300.py` referencia o `CommercialRouterHandler` de `bounded-fence-qa/commercial_cutover.py`. Corrigido em 2fd1e84. **Nunca confundir FAIL da instrumentação com PASS de segurança.**

## Validação final em GitHub Actions, commit de código 2fd1e84
- [41363305746](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41363305746): matriz 8/12/20, blocos 64/256KiB, 300 relatórios comerciais originais, AES-GCM, revogação, pool, outbox, rollback — **12/12 PASS na primeira execução**. Reexecução adicional também **12/12 PASS**, inclusive cenário concorrente de 300.
- [41363305726](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41363305726): privilégios mínimos, JWT sintético, 16/64/256KiB, dois consumidores, outbox, revogação e falhas remotas simuladas — **7/7 PASS**.
- [41363305786](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41363305786): fluxo comercial HTTP completo 100 OLD/100 NEW/100 rollback com outbox — **1/1 PASS**.
- [41363305770](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41363305770): travas de escrita, outbox após crashes, múltiplos processos, 100/300 e autorização negativa — **5/5 PASS**.
- [41363305750](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41363305750): sequência/offline — **1/1 PASS**.

**Total da primeira bateria final: 26 jobs PASS/0 FAIL. Repetição: mais 12 PASS/0 FAIL.** A repetição do workflow é contabilizada separadamente; não representa 38 cenários independentes.

### HTTP simultâneo 300 / pool 12 / 256KiB
| Tentativa | HTTP 200 | HTTP 503 | 200 incompleto aceito | Negativa pré-header | P95 ms | P99 ms |
|---|---:|---:|---:|---:|---:|---:|
| antes do fix | 291 | 9 | 0 | 9 | 1.008 | 1.129 |
| fix + instrumentação completa | **300** | **0** | **0** | **0** | 1.367 | 1.589 |
| repetição isolada | **300** | **0** | **0** | **0** | 1.295 | 1.525 |

A hipótese de 0 HTTP 503 é demonstrada **nessas duas rodadas**, não como SLA universal; novos processos, redes, horários de COMMIT e falhas reais podem gerar 503 fail-closed. O mecanismo intencional de interrupção pós-header continua protegido; o buffer TCP já entregue não pode ser recolhido.

### Matriz original, 300 HTTP 200 por caso (100 OLD + 100 NEW + 100 rollback)
| Pool PG/processo | Bloco KiB | P99 OLD / NEW / rollback (ms) | GETs íntegros | Guardas SQL instrumentados |
|---:|---:|---|---:|---:|
| 8 | 64 | 2458 / 2266 / 2002 | 300 | 2121 |
| 8 | 256 | 1278 / 1227 / 1150 | 300 | 909 |
| 12 | 64 | 1521 / 1532 / 1506 | 300 | 2121 |
| 12 | 256 | 1058 / 1285 / 1170 | 300 | 909 |
| 20 | 64 | 1947 / 1610 / 1950 | 300 | 2121 |
| 20 | 256 | 1491 / 1268 / 1150 | 300 | 909 |

Todas as seis variantes: `router_errors=0`, `pool.timeouts=0`, `revision_preheader_denials=0`, SHA-256 do relatório comercial original validado. Runners distintos; **não permite escolher causalmente o pool mais veloz**.

## Instrumentação de recursos e custo limitado
- Gzip dos 300 relatórios comerciais completos (fluxo sequencial): **105.525.300 bytes por job**. Gzip da corrida concorrente: **105.518.480 bytes** no primeiro PASS e **105.518.472 bytes** no recheck.
- PostgreSQL descartável: **21.943.987–22.001.331 bytes** de database; índice de histórico **9.805.824 bytes**. Incremento WAL posterior à carga inicial da fixture: **2.712–488.320 bytes**, altamente dependente da janela; não equivale ao WAL mensal ou ao custo de armazenamento persistente.
- RSS do processo principal nas seis configurações: **195.248–279.492 KiB**, **excluindo** os dois workers (~66–68 MiB cada), PostgreSQL, page cache/kernel, proxy real e eventual overhead de TLS. Não alegar RAM total.
- Guardas instrumentados no relatório staged: **909 (256KiB)** e **2.121 (64KiB)** por rodada de 300, não são contagem de todos os SQL statements, WAL, RLS e administração. No teste mixed 300: P95/P99 observados acima. Nenhum GET de mídia real ou streaming de vídeo foi executado.
- Extrapolação restrita: exatamente um relatório comercial de ~351.751 bytes gzip por cliente/dia, 30 dias, sem mídia ou retries = **~1,055 GB para 100 clientes** e **~3,166 GB para 300**. Não inclui imagens, vídeos, armazenamento, heartbeat, custos de execução ou TLS. **Valores em reais, faturamento do Supabase e aptidão para o plano Free não foram medidos**; não foi acessado o projeto oficial.

## PASS / FAIL / BLOQUEIOS
**PASS na bancada descartável:** correção específica do TOCTOU de revisão durante admissão; PostgreSQL17 real com transações, locks e cooperação do escritor; 300 relatórios SHA válidos em duas corridas; sem retries de 401/200 truncado; outbox com recuperação; AES-GCM e manifesto simulado; 8/12/20 e 64/256KiB; testes sintéticos de falha/RLS e rollback.

**NÃO COMPROVADO / PRODUÇÃO NO-GO:** encerramento físico rígido de todos os streams em 420ms; ausência de entrega tardia de bytes pré-commit via kernel/proxy; testes com dois hosts físicos, TLS/cross-region, JWT/JWKS reais, Supabase oficial, KMS real, mídia real e 100/300 TVs; SLA de disponibilidade sustentada; custo oficial em R$, operação mensal ou adequação ao Free.

**Nenhum deploy, migração oficial, alteração de APK, painel, site, TV, Vercel, Supabase ou histórico real.** Apenas QA isolado e esta documentação. **PRODUÇÃO NO-GO.**
