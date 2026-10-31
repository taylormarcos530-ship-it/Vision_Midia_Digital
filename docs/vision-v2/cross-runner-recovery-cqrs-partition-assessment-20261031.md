# Vision V2 — Recuperação entre runners + CQRS leve com partições PostgreSQL 17

**Data:** 31/10/2026. **Branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Decisão:** PASS em QA isolado / **NO-GO** para produção, custos e retenção destrutiva.

## Evidência executada

- [GitHub Actions 41239127134](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41239127134), commit testado `4ee029458554c88ca6f7a3c37592d4a68b230b04`: **4 jobs success** (`recipient`, `package`, `independent-restore`, `cqrs-partition-qa`).
- [Código de exportação e recuperação](../../tests/vision-v2-sequence-qa/cross-runner-qa/archive_across_runners.py), [prova SQL com CQRS e partições](../../tests/vision-v2-sequence-qa/cqrs-partitions-qa/cqrs_partition_qa.py), [workflow](../../.github/workflows/vision-v2-cross-runner-cqrs-qa.yml).
- Somente comprovantes falsos gerados pelo próprio runner, sem arquivo dos clientes e sem credencial Supabase. O PostgreSQL é contêiner temporário chamado `vision_v2_quarantine_disposable`.
- Nenhuma modificação em produção, Vercel, APK, televisão, aparelho, Supabase ou usuário. Nenhum script contém DELETE/retention/cron no sistema real.

## Recuperação independente: resultado real

Roteiro:
1. **Runner A:** gerou RSA-OAEP 3072-bit (recipient) para esta execução. Chave privada de QA salva como artefato de teste de 1 dia, não gravada no repositório ou impressa nos logs.
2. **Runner B:** baixou somente a chave pública, gerou AES-256-GCM aleatória, criptografou **1.000 eventos fictícios**, empacotou a chave AES com RSA-OAEP SHA-256, assinou manifesto com Ed25519 (chave pública de assinatura incluída no manifesto), calculou SHA-256 do arquivo cifrado e do conteúdo decifrado. Enviou ciphertext/manifesto via GitHub Actions Artifact Storage.
3. **Runner C diferente:** baixou dois artefatos (pacote e chave privada QA), verificou assinatura, hash, RSA-OAEP, AES-GCM, sequência, `played_at=NULL`, `billable=false`; restaurou novo SQLite e verificou `PRAGMA integrity_check` + contagem.
4. Falhas em cópias descartáveis: arquivo cortado, adulterado, ausente, assinatura adulterada e chave errada. Os cinco casos **falharam fechados** sem criar um SQLite de restauração parcial.

Trechos reais de log:

```text
QA_ENCRYPTED_ARCHIVE_CREATED=PASS records=1000 bytes=116989 rsa_wrapped=true signed_manifest=true
QA_CROSS_RUNNER_RESTORE=PASS verified_events=1000 ack_unchanged=1000 fake_dates=0 new_sqlite=true
QA_FAIL_CLOSED_TRUNCATED=PASS
QA_FAIL_CLOSED_TAMPERED=PASS
QA_FAIL_CLOSED_MISSING_REMOTE_ARTIFACT=PASS
QA_FAIL_CLOSED_MANIFEST_SIGNATURE=PASS
QA_FAIL_CLOSED_WRONG_KEY=PASS
QA_INDEPENDENT_FAULTS=PASS cases=5 no_original_deletion=true
CROSS_RUNNER_INDEPENDENT_RECOVERY=PASS
```

**Limitações:**
- O armazenamento de artefatos GitHub é externo aos runners e tem transferência HTTPS gerenciada pela plataforma, mas **não é uma configuração S3/Cloud Storage comercial para a Vision**. Artefatos de 1 dia não resolvem retenção plurianual ou backup de desastre da produção.
- A **chave privada de teste também foi distribuída como artefato separado**: usuários autorizados a acessar os artefatos podem obtê-la. Esta arquitetura de chaves é exclusivamente QA; NÃO é isolamento KMS nem proteção criptográfica entre operadores do repositório. A assinatura Ed25519 foi conferida matematicamente, mas a chave pública não é fixada por uma autoridade de produção.
- Não houve falha real do datacenter GitHub, corte de energia, TLS entre serviços configurados pelo projeto, resposta de storage 5xx nesta nova etapa ou teste físico de memória flash. Falhas de rede/órfão já foram simuladas nos 17 testes do protocolo de armazenamento anterior, mas não entre runners nesta execução.
- O watermark `1000` era **somente leitura** e sintético, não ACK real de dispositivo; nenhum sistema remoto foi alterado.
- Nenhum backup completo de player, mídia, painel, keys de produção ou banco Supabase foi produzido.

## CQRS e particionamento PostgreSQL 17 — PASS

Banco de testes:
- Separação lógica de **escrita** (eventos registrados uma vez) de **leitura** (resumos por dispositivo e mês). O consumidor das projeções processa blocos em transações e mantém `through_seq` para não contar duas vezes após reinício. Não são dois bancos: mesmo PostgreSQL isolado.
- Eventos brutos particionados por **mês de recebimento pelo servidor**, usando `PARTITION BY RANGE(received_month)`. Não usar o relógio 1970 da TV como chave de partição, nem inventar `played_at`.
- Identidade/sequência controladas por um cursor e `FOR UPDATE` por stream. Cuidado: índice `UNIQUE` em tabela particionada tem de incluir a chave de partição; **partições mensais sozinhas não asseguram unicidade global por sequência**. O cursor por TV e protocolo de replay de arquivo são necessários.
- O painel consulta `read_month` agregada, não toda `received_event`. Separação CQRS lógica, sem Kafka, sem novo banco ou chamadas adicionais da TV.

Evidência:

```text
CQRS_WRITE_IDEMPOTENCY=PASS events=1000 single_stream_watermark=1001
CQRS_PROJECTION_IDEMPOTENCY=PASS events=1000 read_rows=2 oct=650 nov=350
CQRS_PARTITION_PRUNING=PASS used=received_2026_11 ignored=received_2026_10
CQRS_STORAGE_METRIC raw_partition_bytes=245760 read_projection_bytes=49152 raw_events=1000 projection_rows=2 write_seconds=10.92
CQRS_PROJECTION_ROLLBACK_RECOVERY=PASS restart_idempotent=true
CQRS_NO_FAKE_TIME=PASS all_pending_nonbillable=true
CQRS_PG17_ISOLATED=PASS
```

| Indicador | Valor |
|---|---:|
| Eventos no teste | 1.000 |
| Registros agregados para consulta | 2 |
| Outubro (recebimento) | 650 |
| Novembro (recebimento) | 350 |
| Partições brutas + índices | 245.760 bytes |
| Resumo + índices | 49.152 bytes |
| 1.000 gravações feitas individualmente | 10,92 s no runner de QA (NÃO aceitável como benchmark de escala) |
| Rollback ao falhar uma projeção | PASS |
| Reexecução após falha sem duplicação | PASS |

**O que ainda não foi comprovado:** redução de PATCH/GET reais, ganho de P95 em 7/12/20/50/100 TVs, redução líquida de storage, custo do índice global/arquivo, lag da projeção e redundância de escritas. O resumo **aumenta algum armazenamento** e o batch worker faz SQL interno; portanto CQRS não é economia mágica.

## Escolha tecnológica para a Vision

**Recomendação:** **CQRS leve no PostgreSQL que já usamos + partições por mês de recebimento + resumos de leitura em lotes**. Não começar do zero, não duplicar todo o histórico em outra base, e não implantar broker Kafka ou EventStore neste estágio.

- **TV Box:** continuar SQLite local, cache offline, sequência/boot e sincronização em lotes; nenhuma nova requisição por evento. Heartbeat e comandos seguem seu próprio TTL/backoff; CQRS não resolve o excesso de heartbeats automaticamente.
- **Gateway de escrita:** autenticação, deduplicação, ACK somente após commit de prova (ou arquivo durável/manifesto), uma transação curta por lote; nunca confundir ACK de quarantena com cobrança.
- **Banco:** eventos de recebimento e resumos por empresa/dispositivo/mês com poucos índices orientados às consultas reais. Partições mensais apenas para grandes tabelas comprovadamente lentas ou histórico de auditoria; evitar particionar tabelas pequenas em excesso.
- **Leitura:** API do painel usa resumo de contagens, datas validadas, estado de sync, última atividade. `last_updated` e lag do projetor visíveis; para detalhe individual buscar segmento por sequência / arquivo somente sob demanda.
- **Auditoria:** guardar originais até backup fora do ambiente verificado, com manifesto assinado/autenticado. Não DELETE nem cron por enquanto.
- **Série temporal:** TimescaleDB é tecnicamente útil para séries grandes, mas **Supabase retirou TimescaleDB dos projetos PostgreSQL 17**, segundo documentação oficial: https://supabase.com/docs/guides/database/extensions/timescaledb e https://supabase.com/docs/guides/database/migrating-to-pg-partman . Usar **particionamento nativo PostgreSQL**, e considerar `pg_partman` (https://supabase.com/docs/guides/database/extensions/pg_partman) apenas quando a criação/gestão automática das partições se tornar necessária. Outro banco dedicado de séries temporais adicionaria custo, replicação e pontos de falha.
- **Risco específico:** se o recebimento for particionado por mês e houver reenvio após um mês, o cursor contínuo da TV deve continuar garantindo idempotência entre meses; não confiar apenas em chave primária `(received_month,device,seq)`. Não excluir os originais até demonstrar recuperação verificável.

## Projeção preliminar do custo de guardar cada prova no PostgreSQL (não medida nesta etapa)

No benchmark anterior de 105 mil eventos/100 TVs, o tamanho observado foi ~423 bytes por evento para a relação principal com índices. **Extrapolação grosseira** para 7 dias contínuos de 15 segundos por reprodução e sem arquivamento:

| TVs | Eventos / 7 dias | Tamanho ilustrativo bruto + índices |
|---:|---:|---:|
| 7 | 282.240 | ~119 MB |
| 12 | 483.840 | ~205 MB |
| 20 | 806.400 | ~341 MB |
| 50 | 2.016.000 | ~853 MB |
| 100 | 4.032.000 | ~1,70 GB |

Não inclui WAL, mídia, thumbnails, backups, tabelas de projeção, consultas, egress ou crescimento não linear. **Não é cota garantida do Supabase.**

## Gates antes de produção

1. Testar escrita **em lotes** (não 1 INSERT/HTTP por reprodução); medir bytes/chamadas reais sob os mesmos 7/12/20/50/100 TV com PostgreSQL 17 isolado.
2. Avaliar `EXPLAIN (ANALYZE, BUFFERS)` para as consultas reais do painel e comparar CQRS com leitura direta antes de adotar qualquer novo índice.
3. Projetar retenção e replay pós-arquivamento sem armazenar um hash permanente por comprovante; sem DELETE antes de backup remoto verificado e restauração provada.
4. Adotar política segura de chaves com KMS/secret store real, acesso least privilege, revogação e um provedor de objeto com versionamento e retenção. O workflow de QA não substitui isso.
5. Contabilizar estados de prova sem hora com `billable=false`; um resumo mensal pelo **recebimento** não equivale à data comercial da reprodução.
6. Testar isolamento entre empresas com credenciais reais e RLS em banco de homologação separado, com aprovação explícita, sem tocar no ambiente oficial.

**Resultado: 4 jobs PASS; CQRS/partições com resultados concretos; recomendação arquitetural favorável a PostgreSQL nativo leve, sem segundo banco de séries temporais neste momento. Produção intacta.**
