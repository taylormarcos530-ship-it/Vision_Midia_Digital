# Vision V2 — fila SQLite segmentada de 7 dias offline (31/10/2026)

**Status:** PASS técnico de banco nativo em Robolectric; **NO-GO** para APK/TV física/produção. Sem Supabase nem alterações de aplicativo.

## Fonte e evidência verificável

- Branch isolada: `experiment/vision-v2-sequence-watermark-qa-20261031`.
- [GitHub Actions 41225822278](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41225822278), commit testado `a4fd749cc93eacba6f15b521377981de3ddbba44`.
- Log: `BUILD SUCCESSFUL in 56s`, `ANDROID_SQLITE_ROBOLECTRIC=PASS`, `NO_APK=true NO_INSTALL=true NO_DEPLOY=true NO_SUPABASE=true NO_SECRETS=true`.
- XML: `SegmentedOfflineQueueTest` 10 PASS; `SequenceStoreTest` 19; `SequenceStoreFailureTest` 15; `SequenceStoreCapacityTest` 5; `UnresolvedAuditQueueTest` 8. **Total: 57 PASS, 0 FAIL, 0 erros, 0 skipped**.
- Código QA: [SegmentedOfflineQueue.java](../../tests/vision-v2-sequence-qa/android-sqlite-qa/src/main/java/br/com/visionmidia/v2qa/SegmentedOfflineQueue.java), [SegmentedOfflineQueueTest.java](../../tests/vision-v2-sequence-qa/android-sqlite-qa/src/test/java/br/com/visionmidia/v2qa/SegmentedOfflineQueueTest.java).

## Implementação somente de bancada

- Novo banco `vision_v2_seven_day_qa_only.db`, independente da fila anterior de 2.000 eventos. **Não foi integrado ao `player.js` nem ao projeto `android-player`.**
- Segmentos **lógicos** de 1.024 reproduções, implementados com `segments` e `receipts` dentro do **mesmo arquivo SQLite**, e não 40 bancos ou 40 tabelas independentes.
- Filas/contadores por stream e TV; **INSERT de lotes e incremento de sequências atômicos**. Identificação única por evento pendente, sem ledger permanente de um hash por cada evento já confirmado.
- ACK só quando marcado verificado pela camada chamadora (booleano de QA, **não autenticação real**), exclusão do prefixo confirmado e atualização de contadores de segmento dentro da mesma transação.
- `SystemClock.elapsedRealtime` e ID de boot fornecidos pela camada nativa (o protótipo recebe valores; não verifica identidade real do boot). Sem âncora do servidor autenticada, as datas ficam nulas, e o envio FIFO é bloqueado.
- Auditoria de comprovantes sem horário: original e SHA-256 das propriedades preservados em tabela separada; journal imutável sob operações comuns. Revisão de boot antigo **não fabrica data e não autoriza ACK**.
- `MAX_PENDING=50000`: o evento 50.001 é rejeitado, sem substituir ou apagar os anteriores. `MAX_DATABASE_BYTES=64 MiB` como objetivo/configuração de `PRAGMA max_page_count` do arquivo principal. **Esse PRAGMA não equivale a uma cota total confiável quando WAL está ativo**.

## Medição real de SQLite nativo em runner descartável

Hipótese: uma TV exibindo continuamente, uma reprodução a cada 15 segundos (24 h/dia), sete dias inteiros.

| Indicador observado | Resultado |
|---|---:|
| Eventos preservados após 7 dias | **40.320** |
| Segmentos lógicos | **40** |
| `PRAGMA page_count × page_size` após reabrir | **4.165.632 bytes = 4,17 MB ≈ 3,97 MiB** |
| `db_file` após reabrir | **4.165.632 bytes** |
| WAL após reabrir | **0 bytes** |
| SHM observado após reabrir | **32.768 bytes** |
| Contador contínuo após reabrir | **40.321** (próxima sequência) |
| Verificação física e lógica | **PASS** |
| Envio sem referência de horário (clock 1970) | **0** (bloqueado, sem inventar data) |
| Teto de pendências testado | **50.000** |
| Segmentos no teto | **49** |
| Páginas SQLite para 50.000 | **5.185.536 bytes = 5,19 MB ≈ 4,95 MiB** |
| Tentativa de registrar evento 50.001 | **Rejeitada; registros anteriores intactos** |

O log também mediu **antes de reabrir** para 40.320: `page_bytes=4165632`, `db_file=4124672`, `wal_file=519152`, `shm_file=32768`. **O consumo de disco deve considerar banco, WAL e SHM simultaneamente.** Depois de reabrir e checar, WAL zerado e arquivo principal regularizado. O número 4,17 MB não representa vídeo, imagem, toda a TV, backup, indexação adicional, criptografia, logs, upload ou armazenamento em nuvem.

## Falhas, correções e limitações honestas

- [Primeira execução com 10 testes novos — 41225551958](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41225551958): **56 PASS / 1 FAIL**; a cota `max_page_count` não provocou `SQLiteFullException` no modo WAL usado por padrão.
- Alteração isolada no experimento: preservar WAL padrão, mas permitir `journal_mode=DELETE` especificamente no teste de erro físico de páginas, sem mudar a utilização normal.
- [Execução intermediária — 41225709742](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41225709742): FAIL de ambiente antes de testar; Gradle não conseguiu resolver dependências como JUnit e Robolectric.
- Workflow ganhou nova tentativa de execução somente em caso de falha de dependências; nenhum passo de deploy.
- [Execução final — 41225822278](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41225822278): **57 PASS**. Log literal: `V2_SQLITE_FULL_TEST_JOURNAL_MODE=DELETE`, `V2_SQLITE_FULL_CLASS=android.database.sqlite.SQLiteFullException`, `V2_SQLITE_FULL_CAUSE=database or disk is full (code 13 SQLITE_FULL)`.
- A falha de páginas foi validada em **DELETE journal**, **NÃO** em WAL com disco físico realmente cheio. A proteção contra corte elétrico e `fsync` real na eMMC da TV Box também não foi medida.
- O modelo de 50 mil linhas oferece 9.680 eventos extras além dos 40.320 da semana — cerca de 1 dia, 16 horas e 20 minutos adicionais a um evento a cada 15 segundos. Passado isso, **para de registrar novos comprovantes**; sem alerta externo, isso ameaça a prestação de contas.
- Com relógio inválido durante um boot encerrado sem sincronização, os eventos podem ficar sem data comprovável. A auditoria preserva a prova, mas **não existe uma conciliação automática segura dessas datas**; o bloqueio pode impedir o envio de eventos posteriores.
- Audit proofs e reviews ainda exigem limite independente, exportação/restauração comprovada e política de retenção. Sem essa política, o journal de auditoria e o WAL podem crescer além dos limites apenas de linhas pendentes. Não declarar "armazenamento limitado indefinidamente".
- Não há integração HTTP JWT/Edge, acesso multiempresa, upload no Supabase, garantia de deduplicação após ACK de event IDs antigos, nem comparação de consumo real em TVs Android ou de custos cloud.
- O experimento não demonstra 7 dias de execução física do aparelho, apenas que os 40.320 comprovantes foram persistidos e conferidos num teste concentrado.

## GO/NO-GO

**PASS:** 7 dias sintéticos integralmente salvos e recuperados, segmentos, counters, limite de 50 mil, invariantes SQLite, falha física de quota em journal DELETE e auditoria que não inventa horários.

**NO-GO produção:** até validar (1) armazenamento em WAL sob falha física, (2) durabilidade e espaço na TV Box real, (3) boot/relógio autenticado, (4) conciliação de comprovantes antigos, (5) alertas e limites da auditoria, (6) ACK/auth reais, (7) custos das chamadas e banco na carga, (8) backup/rollback auditados.

**Nenhuma alteração em Supabase V1/V2, APKs, Vercel, painel, domínio, campanhas, clientes ou TVs.**
