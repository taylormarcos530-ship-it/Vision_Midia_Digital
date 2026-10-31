# Vision V2 — Quarentena PostgreSQL 17: escala 7 / 12 / 20 / 50 / 100 TVs

**Data:** 31/10/2026. **Conclusão:** **PASS 5/5** do benchmark isolado; **NO-GO para produção, migração ou retenção com exclusão**. Nenhum projeto Supabase, Vercel, APK, TV, site ou painel foi alterado.

## Evidência executada (não só estimativa)

- [GitHub Actions 41234464324](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41234464324), commit testado `c28b2a286bd05979a9e813ac6b69cd2acfd9e7a0`; conclusão GitHub `success`. Cinco jobs separados, 7/12/20/50/100 TVs, todos `success`.
- [Código de benchmark](../../tests/vision-v2-sequence-qa/quarantine-qa/scale_benchmark.py), [arquivo imutável de bancada](../../tests/vision-v2-sequence-qa/quarantine-qa/shadow_archive.sql) e [workflow sem deploy](../../.github/workflows/vision-v2-quarantine-scale-qa.yml).
- Cada job criou o **próprio PostgreSQL 17 local** (`vision_v2_quarantine_disposable`) em contêiner descartável, autorizado pela guarda SQL; sem credenciais, endpoint ou banco real.
- **Amostra por TV:** `1.000` comprovantes inseridos via `COPY` PostgreSQL (carga de armazenamento, **não throughput HTTP**), depois `50` comprovantes novos enviados por HTTP local, repetidos em **3 requisições simultâneas** por TV. O servidor QA aceita 1 cópia e trata 2 como reenvio. Até 12 workers HTTP por job. Os comprovantes estão **sem data de exibição** e sempre `billable=false`.
- Antes e depois medidos com `pg_relation_size`, `pg_indexes_size`, `pg_total_relation_size`, `pg_database_size` e `pg_wal_lsn_diff(pg_current_wal_insert_lsn())`. WAL é **geração lógica em bytes**, não tamanho atual dos segmentos WAL no disco. Arquivo de auditoria shadow adicionado **depois** da medição principal.

## Resultado por escala (medição real; MB em base decimal)

| TVs | Eventos originais | Eventos finais | Heap receipts | Índices receipts | Receipts total | Database total | WAL carga bulk | WAL HTTP | HTTP reqs (3 por TV) | ACK final | P95 HTTP |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 7 | 7.000 | 7.350 | 1,647 MB | 1,409 MB | **3,088 MB** | 10,942 MB | 3,885 MB | 0,243 MB | 21 | 1.050 | 231,02 ms |
| 12 | 12.000 | 12.600 | 3,146 MB | 2,376 MB | **5,554 MB** | 13,408 MB | 6,656 MB | 0,425 MB | 36 | 1.050 | 306,46 ms |
| 20 | 20.000 | 21.000 | 4,719 MB | 3,981 MB | **8,733 MB** | 16,586 MB | 11,115 MB | 0,722 MB | 60 | 1.050 | 145,78 ms |
| 50 | 50.000 | 52.500 | 11,649 MB | 10,338 MB | **22,020 MB** | 29,907 MB | 28,301 MB | 1,775 MB | 150 | 1.050 | 262,73 ms |
| 100 | 100.000 | 105.000 | 23,421 MB | 20,922 MB | **44,376 MB** | 52,279 MB | 56,950 MB | 3,527 MB | 300 | 1.050 | 274,57 ms |

**Observações:** `pg_total_relation_size(receipts)` pode incluir páginas auxiliares além de heap+índices, então as colunas não têm necessariamente soma exata. `pg_database_size` inclui objetos de sistema, outros índices e baseline do PostgreSQL; não equivale ao consumo do plano Supabase. Os valores de WAL são diferenças de LSN na fase indicada, não bytes armazenados em estado estacionário. P95 é de uma única rodada local, em runners diferentes, sem rede pública/TLS, e não deve ser usado como SLA.

### Concorrência, replay e ACK — PASS em todos os cinco jobs

| TVs | HTTP novas aceitas | HTTP duplicadas identificadas | Total de reenvios após sombra (adicional) |
|---:|---:|---:|---:|
| 7 | 350 | 700 | 50 |
| 12 | 600 | 1.200 | 50 |
| 20 | 1.000 | 2.000 | 50 |
| 50 | 2.500 | 5.000 | 50 |
| 100 | 5.000 | 10.000 | 50 |

- Cada TV terminou com `watermark=1050`; nenhuma duplicata criou novo recibo, e `event_played_at` permaneceu NULL, `billable=false`.
- Requisição com lacuna de sequência foi rejeitada, credencial de outra empresa foi rejeitada e replay antigo foi reconhecido sem alteração da contagem.
- A rotina de `shadow archive` copiou **1.000 provas completas da primeira TV** para tabela imutável em schema QA separado, com manifesto `SHA-256` calculado sobre a sequência e hashes dos eventos; releu e validou manifesto contra **os registros originais independentes**.
- Simulação de falha no meio da cópia: segunda inserção da mesma chave causou `UniqueViolation`, e a transação não deixou registro parcial. Fonte e ACK intactos.
- **Depois da cópia**, um novo HTTP de 50 comprovantes antigos confirmou `accepted=0`, `duplicates=50`, `ack=1050` e contagem original inalterada. Mensagem real: `QA_ARCHIVE_REPLAY_ROLLBACK_PASS manifest_sha256_verified=true after_archive_duplicates=50 rollback_preserved=1000`.
- Tamanho adicional da **cópia experimental** das 1.000 provas: `327.680 bytes` para `archive.proofs` + `32.768 bytes` para manifestos, em cada caso. WAL extra na fase de cópia e ensaios ≈434 KiB. Isso **aumentou** o uso de disco no laboratório — arquivar sem excluir não economiza espaço por si só.

## Risco confirmado de crescimento

No cenário 100 TVs, `44.376.064 bytes / 105.000 eventos` ≈ **423 bytes por comprovante**, em média, para `receipts` com índices, sem considerar `devices`, WAL, bancos auxiliares, mídia, backups ou logs. Extrapolar essa densidade para sete dias inteiros (`100 × 40.320 = 4.032.000 eventos`) dá cerca de **1,70 GB** só nessa relação — **estimativa grosseira e não medida em banco com 4 milhões de linhas**; tamanho e custo não são rigorosamente lineares.

**Decisão:** não afirmar que 100, 300 ou mais TVs cabem no plano grátis baseado nesses testes. Hoje a prova de idempotência histórica depende da existência de `receipts` antigos, que continuarão crescendo se não houver política verificável de arquivamento e deduplicação.

## Projeto de retenção auditável (documental, sem apagar originais)

**Fase A — Arquivo de prova antes de qualquer expurgo:**
1. Selecionar lotes fechados de sequência por empresa, TV e stream, sem salto; nunca selecionar período ainda não conciliado ou com reenvios em trânsito.
2. Criar snapshot consistente, manifesto assinado/autenticado com SHA-256 por segmento, contagem, primeira/última sequência, data de recepção (não data inventada de exibição), estado de faturamento e versão de schema.
3. Exportar prova completa cifrada em armazenamento externo com chave do usuário; confirmar hash, a entrega durável e um teste de restauração separado. Manter ao menos duas cópias independentes e registro de retenção; **nada disso foi integrado nesta etapa**.
4. Gravar no banco um **índice permanente mínimo de evidências por stream/segmento**, capaz de provar qualquer replay antigo pelo hash original **sem reescrever um blob monolítico crescente**. Uma janela esparsa ou contador apenas não basta para aceitar e comparar payloads alterados em sequências anteriores; esse índice precisa ser projetado e testado com concorrência real, custo de I/O e impossibilidade de falso ACK.
5. Somente após verificar transferência, restauração e replay pós-arquivamento por chave original, preparar um mecanismo futuro para reduzir linhas locais de `receipts` em lotes pequenos, com logs/rollback, mas **não implementar DELETE/cron/TTL agora**.

**Fase B — Reenvios após eventual arquivamento futuro:**
- `watermark` é o maior número confirmado; não retroceder. Quando evento `seq≤watermark` já não estiver na tabela ativa, a API deve resolver sua identidade/veracidade no índice histórico ou arquivo recuperável; se não conseguir provar a igualdade do payload, **não responder como duplicado válido**.
- Replays com payload divergente → conflito auditável. ACK sem confirmação de prova durável → proibido.
- Nunca contabilizar recibo sem data como exibição datada/faturada. A quarentena é uma categoria separada, com exportação e relatórios separados.
- O teste desta rodada confirma replay **com originais ainda presentes**, e **NÃO** comprova replay depois de exclusão real. Esse é o bloqueio central para implementar retenção.

## Limites de homologação

- Só 1.050 eventos por TV, não 40.320; os 1.000 iniciais usam COPY, não o gateway HTTP. Há 50 novos eventos HTTP por TV mais reenvios — sem rede real, Supabase Edge, JWT real, Storage, painéis ou APK.
- Apenas uma execução por escala, sem medição de variação, P95 sustentado, pico de CPU/IOPS, custo de plano, travamento físico ou failover; `PostgreSQL 17` foi criado do zero em contêiner e descartado depois de cada job.
- A cópia shadow de 1.000 provas foi local, **sem backup criptografado nessa etapa**, sem remote upload, sem remoção e sem verificação de restauração a partir de serviço externo. O teste anterior de AES-256-GCM cobre apenas auditoria SQLite sintética, não o arquivo PostgreSQL desta etapa.
- Trigger de imutabilidade não protege contra administrador privilegiado, restauração de snapshot alterado, ou falta de backup remoto.
- A densidade de 423 bytes/evento e projeção ~1,7GB são indicadores de risco, não estimativas exatas de uso em produção.

**Decisão formal: PASS de escala limitada para contagem, concorrência, tamanhos SQL e arquivo sombra sem exclusão. NO-GO para retenção por DELETE, compactação real, migração ou 100 TVs em produção.** Mantidas todas as proteções da Vision atual.
