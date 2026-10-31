# Vision V2 — 12.096.000 comprovantes: 300 TVs × 7 dias × reprodução a cada 15 segundos (QA isolado)

**Data:** 31/10/2026. **Branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Resultado real: 12/12 shards PASS, 0 FAIL na execução final.** Somente dados sintéticos, PostgreSQL 17 em contêineres descartáveis no GitHub Actions e SQLite local no runner. **NO-GO para implantação, backend único, uso do Supabase Free ou exclusão de originais.**

## Evidências verificáveis do GitHub Actions

- **Piloto shard 0, 25 TVs × 40.320 eventos:** [run 41245063466](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41245063466), código `7ff03ceacd99582633d6edac701ff08211647692`, conclusão `success`. 1.008.000 eventos efetivos; `V2_15SEC_SHARD_0=PASS`.
- **Demais 11 shards (shards 1–11, 275 TVs):** [run 41245193925](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41245193925), código `282fd6eec1ad570245ab37e817e919f28d61d36e`, conclusão `success`, **11/11 jobs success**. 11.088.000 eventos adicionais. O arquivo Python permaneceu o mesmo testado no piloto; o único commit posterior do workflow mudou a matriz de `[0]` para `[1..11]`.
- [Implementação experimental do teste](../../tests/vision-v2-sequence-qa/full-15sec-qa/shard.py) e [workflow estritamente isolado](../../.github/workflows/vision-v2-full-15sec-shards-qa.yml).
- Histórico transparente de falhas de QA: [run 41244880754](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41244880754) **FAIL** no piloto por pressupor que 40.320 fosse múltiplo de 50; [run 41244932612](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41244932612) **FAIL** no contador de métricas que incrementava 50 na última transação de 20 itens. A implementação de QA foi corrigida, os comprovantes permaneceram em 40.320 por TV e os dois runs finais passaram. Nenhum código de produção foi alterado.

## Exatamente o que foi executado

- Doze **bancos PostgreSQL 17 independentes e descartáveis**, com **25 TVs sintéticas em cada um**. Cada TV produziu **40.320 comprovantes**, correspondentes a **7 × 24 × 60 × 60 / 15 segundos**. Foram processados **12.096.000 comprovantes distintos** (não apenas extrapolados).
- Cada TV teve **um arquivo SQLite verdadeiro** criado em Python, com 40.320 provas, identificadores de boot A/B, sequência, mídia e SHA-256; tempo da reprodução `played_at=NULL` e nunca faturável. Houve fechamento/reabertura de SQLite na primeira TV de cada shard. Originais não removidos durante ingestão.
- Escrita PostgreSQL via **transações SQL reais de até 50 eventos**; a última de cada TV contém **20 eventos**. **20.175 transações por shard**, **242.100 transações totais**. O percurso de 12 milhões foi **SQLite Python → transações PostgreSQL**, sem HTTP real, TLS, edge functions, JWT, FCM, TV Box, mídia ou APK; o fluxo HTTP de escala menor foi comprovado em testes anteriores, mas não neste benchmark integral.
- Meses de recebimento sintéticos Outubro/Novembro de 2026, com duas partições. Dias 1–2 de um período de indisponibilidade virtual são recebidos no dia 3; **a data de recepção não é usada para inventar a data de reprodução**. `played_at` sempre NULL, `billable=false`.
- Confirmado cursor por dispositivo no PostgreSQL `watermark=40320` e resumo CQRS `through_seq=40320` ao final. Conferidas 1.008.000 linhas e somatório CQRS por shard, ausência de lacunas, 25 dispositivos, integridade das provas, divisão entre partições, identidade por empresa e dados sem hora.
- **15.000 provas historicamente reenviadas e verificadas**, 50 para cada uma das 300 TVs; comparação com hash original, sem novo INSERT ou avanço de ACK.
- **Uma falha transacional real injetada** no shard piloto (TV 000, lote iniciado na sequência 101), após inserção antes de atualizar watermark. Confirmado `ROLLBACK`, sem linhas parciais nem alteração do ACK, seguido de reenvio bem-sucedido. Esse mecanismo de falha **não foi reexecutado nos outros 11 shards**.
- Um SQLite por TV manteve até `17.280` recibos correspondentes a três dias virtuais antes da reconciliação; limite lógico de fila configurado em 50.000. No benchmark integral **não houve SQLITE_FULL, corte elétrico ou esgotamento real de disco**.

## Resultado por shard: medidas coletadas nos logs reais

| Shard | TVs | Eventos | Banco PostgreSQL (MB) | WAL gerado (MB) | Índices PG (MB) | Tempo de escrita (s) | PASS |
|---:|---|---:|---:|---:|---:|---:|---|
| 0 | 000–024 | 1.008.000 | 289,421 | 466,562 | 79,847 | 55,69 | PASS |
| 1 | 025–049 | 1.008.000 | 289,437 | 466,766 | 79,864 | 48,30 | PASS |
| 2 | 050–074 | 1.008.000 | 289,429 | 466,512 | 79,864 | 58,31 | PASS |
| 3 | 075–099 | 1.008.000 | 289,421 | 466,600 | 79,856 | 54,75 | PASS |
| 4 | 100–124 | 1.008.000 | 289,388 | 466,670 | 79,856 | 50,39 | PASS |
| 5 | 125–149 | 1.008.000 | 289,421 | 466,567 | 79,847 | 56,06 | PASS |
| 6 | 150–174 | 1.008.000 | 289,421 | 466,675 | 79,847 | 50,63 | PASS |
| 7 | 175–199 | 1.008.000 | 289,429 | 466,673 | 79,864 | 39,21 | PASS |
| 8 | 200–224 | 1.008.000 | 289,429 | 466,641 | 79,864 | 53,65 | PASS |
| 9 | 225–249 | 1.008.000 | 289,429 | 466,613 | 79,856 | 57,03 | PASS |
| 10 | 250–274 | 1.008.000 | 289,388 | 466,612 | 79,856 | 54,61 | PASS |
| 11 | 275–299 | 1.008.000 | 289,421 | 466,622 | 79,847 | 39,00 | PASS |
| **Soma dos 12** | **300 TVs** | **12.096.000** | **3.473,035** | **5.599,514** | **958,267** | **617,63** | **12/12** |

MB decimal, 1 MB = 1.000.000 bytes. Estes números **somam 12 bancos independentes**, incluem overhead do PostgreSQL em cada shard e **não** são medições de um único banco com 12 milhões de linhas. WAL é diferença entre LSNs durante a execução e representa WAL **gerado**, não o total atual de arquivos WAL retidos em disco. Os 12 jobs foram executados em runners GitHub variáveis (máximo de 3 simultâneos); somar os tempos não mede latência real ponta a ponta nem throughput de um banco único.

### Agregados numéricos

| Grandeza | Soma observada nos 12 shards |
|---|---:|
| Comprovantes distintos | **12.096.000** |
| Transações PG17 | **242.100** |
| Banco PostgreSQL (todas as bases) | **3.473.035.364 bytes** |
| Tabelas de histórico + índices | **3.376.750.592 bytes** |
| Somente índices do histórico | **958.267.392 bytes** |
| WAL gerado | **5.599.514.216 bytes** |
| SQLite local, arquivos somados | **3.125.439.840 bytes** |
| Reenvios históricos idempotentes | **15.000** |
| Tempo somado das etapas de escrita por shard | **617,63 s** |
| Tempo agregado de catch-up CQRS por shard | **10,293 s** |

Por comprovante nos esquemas artificiais e bancos separados do teste: ~**287 bytes** de banco total (com overhead duplicado), ~**79 bytes** de índice do histórico e ~**463 bytes** de WAL gerado. Esses coeficientes **não** podem ser transferidos diretamente para o schema real, índices atuais, storage/custos do Supabase ou mídia.

## Desempenho, integridade e read-model CQRS

- Velocidade por banco descartável: **17.288–25.849 eventos por segundo**, incluindo geração de SQLite e commits em lote, runner sem rede de produção. **Não é benchmark com 300 dispositivos concorrentes em um único gateway HTTP**.
- P95 por lote transacional PostgreSQL: **1,458–2,644 ms**, medido separadamente em cada shard; não inclui RTT de internet, validação JWT, RLS real, latência Supabase Edge nem sincronização com mídias.
- CQRS diário com resumo por dia de **recebimento** e empresa, um cursor por stream. Todas as 40.320 provas de cada dispositivo foram projetadas; maior lag **40.320 eventos por TV** antes da rodada do projetor; o tempo de catch-up agregado dos 12 shards foi **10,293 segundos**, não uma garantia de lag sustentado.
- Cada job comparou `COUNT(*)` direto do histórico e `SUM(pending_time)` do CQRS sob filtro por tenant e dia. Os valores bateram; `EXPLAIN ANALYZE BUFFERS` registrou tempos reais em cada job. A estrutura de leitura em escala não elimina o armazenamento original nem a necessidade de retenção segura.
- A escrita de todos os comprovantes preservou `played_at=NULL`, `billable=false` e o sequenciamento por TV. Nenhuma data da reprodução foi reconstruída a partir do RTC 1970.

## Gates de tempo, armazenamento e recursos

**Verificados antes do início de cada shard:**
- Nome do banco **exatamente** `vision_v2_quarantine_disposable`; versão PostgreSQL 17.
- Espaço livre no host pelo menos **3 GiB** (os logs de QA mostram aproximadamente 93 GB disponíveis no piloto).
- Banco preexistente abaixo de **1.500 MiB**.
- Timeout lógico de carga **540 s** por shard, além do timeout GitHub Actions **18 minutos** por job.
- Verificações intermediárias de `pg_database_size()`, `pg_wal_lsn_diff()`, tempo e espaço a cada 1.200 lotes e ao final; cap de tamanho PostgreSQL **1.500 MiB por shard** e WAL gerado **4 GiB por shard**.
- Maior banco final observado **289.437.363 bytes**; WAL máximo observado **466.765.536 bytes**, muito abaixo dos respectivos gates. **Não houve teste de atingir os gates** e nem enforcement físico de cota. Caso atingidos, o job aborta com falha; isso não é política de armazenamento para produção.

## O que NÃO está homologado por esta execução

1. **12 milhões em um único PostgreSQL/Supabase**: os eventos foram distribuídos em **12 instâncias descartáveis**. Soma de volumes não implica desempenho, índices, locks, autovacuum, RAM, tamanho físico ou custos equivalentes quando tudo se concentra em uma instância.
2. **HTTP/Edge Function real 12M**: as 242.100 transações foram chamadas SQL diretamente. Não é medição de número/latência de requisições HTTP, autenticação, RLS/JWT, CDN, Storage, Internet das TVs ou telemetria do painel.
3. **Falha física/disco cheio real**: SQLite `SQLITE_FULL` genuíno foi coberto anteriormente em outra suíte (47 testes PASS), mas não nesta carga de 12 milhões. Também não houve corte de energia ou recuperação física em Android.
4. **Capacidade do Supabase Free**: é proibido concluir que suporta 100/300 TVs com base no teste. WAL gerado não equivale a bytes de banco ou cotas faturadas; história/índices/backup/Storage e outras funções reais precisam ser medidos separadamente.
5. **Concorrência da carga**: até três bancos separados executaram em paralelo; dentro de cada banco as 25 TVs foram ingeridas **sequencialmente** pelo script. Não foi realizado teste de 300 conexões/TVs concorrentes em um único gateway.
6. **Retenção/arquivamento real**: nenhum original foi excluído. Particionamento ajuda ao selecionar intervalo, mas não impede crescimento do histórico. Arquivo externo criptografado com restauração foi testado em suites QA anteriores, não conectado a este fluxo integral de 12M.
7. **Política de hora/licença/autorizações**: nenhuma reprodução sem relógio deve se tornar datada/faturável. O teste registra apenas dia sintético **de recepção**.
8. **Mídia e player**: nenhuma mídia, APK, TV Box, quiosque, boot real, push real, web socket ou fluxo do Vercel foi testado nesta carga.

## Próxima recomendação de gate

- Antes de considerar implantação: teste de **um PostgreSQL17 descartável** com volume crescente (1M → 3M → 6M → 12M), proteção de espaço/tempo e concorrência real de lotes, medindo PG indexes, locks, CPU, autovacuum, WAL e P95. Não executar no Supabase oficial.
- Separadamente: teste de HTTP gateway com multiempresa, RLS e 100–300 clientes simultâneos de rede local; medir limite real de HTTP, push revisional e fallback.
- Depois: arquivo cifrado remoto de provas históricas + replay auditável, verificação de restauração, sem exclusão até aprovação expressa; projetor incremental com metas verificáveis de lag e controles de quota.
- Manter a Vision atual funcionando; sem merges, releases, deploys, alterações em `main` ou instalação.

**Veredito formal: 12/12 PASS para o conjunto distribuído dos 12.096.000 comprovantes completos, com hardware/server QA e workload explicitamente limitado; NO-GO para alegar que um único Supabase suporta 300 TVs.**
