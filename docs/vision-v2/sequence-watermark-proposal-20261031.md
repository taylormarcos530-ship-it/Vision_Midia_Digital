# Vision V2 — Proposta QA: sequência contínua por TV (31/10/2026)

**Estado:** EXPERIMENTO, NÃO IMPLEMENTADO NO SUPABASE. Branch isolada `experiment/vision-v2-sequence-watermark-qa-20261031`, derivada de `feature/vision-v2-isolated-foundation-20261031`.

## Problema do antigo projeto
O banco V1 gerou muitas gravações de reproduções, chamadas repetitivas de consulta/heartbeat e índices grandes. O protótipo F1 da V2 ainda mantém `playback_event_keys` (uma chave permanente por evento) e `playback_recent` (uma linha por evento), logo **envio em lote não diminui, sozinho, a quantidade de linhas gravadas**.

## Estratégia experimental
Para cada TV com um **stream de pareamento único e autenticado**, o player atribui uma sequência estritamente crescente a cada reprodução. Salva o evento e incrementa o contador **na mesma transação local durável**. Envia lotes de 1 a 50; o servidor confere credencial, stream e sequência, serializa as gravações por TV usando **transação PostgreSQL + SELECT FOR UPDATE**, rejeita lacunas, contabiliza apenas novas sequências e atualiza o maior número confirmado (`watermark`) na mesma transação do agregado diário. **ACK perdido** implica reenvio; o servidor retorna a confirmação já persistida sem duplicar a contagem. O cliente só elimina da fila o que recebeu ACK válido.

Com isso, o controle permanente de deduplicação pode ser um contador por stream/TV, não uma linha/hash por evento. Os eventos recentes ainda podem precisar de retenção auditável, e o relatório diário precisa sobreviver ao arquivamento; esses detalhes não estão solucionados por este protótipo.

**Restrições críticas:** reinício não pode apagar fila, número ou identidade do stream; reinstalação/troca de TV exige novo pareamento e política de conciliação, nunca reiniciar contador no stream antigo; lotes fora de ordem precisam esperar/retransmitir; queda antes/depois do commit não pode dobrar total; fraude ou replay entre empresas não pode atravessar credenciais; falha de armazenamento local é impeditivo; relógio 1970 exige metadados de boot/âncora temporal, sem contagem em dia errado; sequência atômica sem prova persistente não existe apenas com `localStorage`; validar Android/SQLite/IndexedDB real.

## Simulação executada (não é teste de banco nem APK)
Código: [modelo](../../tests/vision-v2-sequence-qa/model.cjs) e [testes](../../tests/vision-v2-sequence-qa/model.test.cjs).
Reinício preservando estado, ACK perdido, quedas antes do commit, lacunas, fora de ordem, concorrência, rejeição de stream antigo, limites e agregados são ensaios em **memória**. O modelo contém um bloqueio explícito para estado perdido. `TODO` significa **NÃO HOMOLOGADO**.

## Projeção teórica de armazenamento (não é medição de Supabase)
Hipótese deliberadamente alta: TVs reproduzindo sem interrupção, um evento a cada 15 segundos, 30 dias/mês. Volume real é menor com pausas e horários restritos.

| TVs | Eventos em 30 dias | Eventos brutos dos últimos 7 dias |
|---:|---:|---:|
| 7 | 1.209.600 | 282.240 |
| 12 | 2.073.600 | 483.840 |
| 20 | 3.456.000 | 806.400 |
| 50 | 8.640.000 | 2.016.000 |
| 100 | 17.280.000 | 4.032.000 |

Com 100 TVs, **somente** uma chave SHA-256 de 32 bytes por evento representaria 552.960.000 bytes em 30 dias **antes** de linhas PostgreSQL, índices, WAL, resumo diário, backups e mídia. O modelo de sequência elimina esse ledger crescente se — e somente se — o protocolo contíguo for validado. **Não elimina o processamento de eventos** nem garante sozinho a redução de custos.

Em 100 TVs, sincronização a cada 5 minutos + envio otimista de lotes completos de 50 registros gera aproximadamente 864 mil consultas de sync e 345,6 mil envios de reprodução em 30 dias, **1.209.600 invocações mensais teóricas**. Não inclui retry, painel, avisos, outras funções/projetos ou upload de mídia. Esse ritmo pode atrasar a contagem até 12,5 minutos por TV em reprodução contínua, exigindo uma política comercial explícita de latência e orçamento. Não prometer capacidade de 100/300 TVs apenas com essa conta.

## Comparação com alternativas
- **Ledger por evento permanente (V2 atual):** deduplicação simples, mas crescimento proporcional a cada exibição e overhead de índices.
- **Hashes empacotados/segmentados (V30):** preserva identidade histórica, porém cresce proporcionalmente a eventos e pode amplificar escrita quando segmentos são reescritos. Já existem testes de 300 mil chaves no repositório, que não equivalem a homologação da V2.
- **Sequência contígua + watermark (este experimento):** estado permanente de deduplicação O(TVs/streams), rejeita lacunas e aceita retries; exige persistência transacional no player, serialização real no banco, gestão de novas sessões e política de auditoria/retensão.
- **Resumos diários sem prova de idempotência:** baixo armazenamento, mas inaceitável: reenvios duplicam faturamento/relatório.

## Critérios para avançar
**NO-GO** para alterar API V2 ativa, APK, painel Master, Supabase legado, Storage ou TVs reais. Antes:
1. Porta real SQL/RPC com testes de concorrência e atomicidade em PostgreSQL descartável. Comparar EXPLAIN, WAL, CPU, índices, P95 e pg_total_relation_size.
2. Player Android QA com armazenamento transacional real; ensaios de energia desligada e de cota cheia; clock 1970, FIFO offline e resposta perdida.
3. Dashboard e portal anunciante devem entregar contagens reconciliadas, sem divulgar resultados falsos ou apagar comprovantes antes de backup/restauração.
4. Cotas e egress monitorados em ambiente QA com 7, 12, 20, 50 e 100 TVs simuladas; folga de 30% no orçamento escolhido, incluindo outros projetos.
5. Plano de rotação de stream (reinstalação/repareamento) com reconciliação de fila pendente e rollback ensaiado.

**Nenhuma migração, cron, compactação ou exclusão de eventos reais foi executada.**


## Evidência de CI executada (GitHub Actions, 31/10/2026)

**Contrato Node (mock, sem rede):** [execução 41221447094](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41221447094), 19 PASS, 0 FAIL e 3 TODO (relógio/UTC/horário local, persistência Android, integração PostgreSQL de escala).

**SQL PostgreSQL 17 real, descartável:** [execução 41221673625](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41221673625), PASS para rejeição de token/stream incorretos, lacuna, repetição, hora 1970, atomicidade de lote; 6 processos concorrentes gravaram somente os 2 eventos inéditos de uma TV. A transação usa SELECT FOR UPDATE e resume por dia/mídia dentro do lote. Isso NÃO substitui RLS/JWT ou avaliação de execução real da API.

**Carga sintética real no PostgreSQL 17 (não Supabase):** [execução 41221775323](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41221775323), 100 TVs × 1000 eventos = **100.000 eventos**, dez mídias por TV e **1.000 linhas de resumo**; soma dos watermarks = 100.000. Dados medidos no log: **devices = 212.992 bytes**, **daily = 1.703.936 bytes**, **total = 1.916.928 bytes (aproximadamente 1,92 MB decimais)** incluindo apenas tabelas+índices dessas duas relações, após 2.000 chamadas de lote. **Tempo interno de carga: ~1.596 ms**, não latência de HTTP/Edge e não throughput sustentado de produção. WAL, espaço de projeto, mídia, backups, autenticação e monitoramento NÃO entram nesse tamanho.

O experimento ainda não tem proteção completa de prazo/campanha, autenticação multiempresa com JWT, intervalo de relógio offline no APK, re-pareamento com fila pendente, armazenamento persistente real e política comercial de auditoria. **NO-GO** para uso com TVs reais, migração ou substituição da V2 atual.
