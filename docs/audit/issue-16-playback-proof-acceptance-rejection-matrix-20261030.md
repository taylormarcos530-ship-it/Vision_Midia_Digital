# ISSUE #16 — MATRIZ DE CRITÉRIOS DE ACEITE E REPROVAÇÃO DA PROVA DE VEICULAÇÃO

**Vision Mídia Digital | 30/10/2026 | Versão documental 1.0**  
**Classificação:** PLANO DE HOMOLOGAÇÃO FUTURA — NÃO EXECUTADO  
**Branch isolada:** `audit/playback-query-performance-20261030`  
**Decisão vigente:** **NO-GO para retenção, exclusão, migração, testes e produção sem autorização específica.**

## 1. Referências e escopo
- [Issue #16 — histórico de reproduções, retenção e crescimento](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/issues/16).
- `docs/audit/issue-16-playback-retention-risk-decision-plan-20261030.md`.
- `docs/audit/issue-16-playback-proof-preservation-specification-20261030.md`.

Esta matriz define **critérios de aceite futuros**, não resultados obtidos. Nenhum dado de produção foi consultado e nenhum teste foi executado. O dossiê arquivado do polling experimental de 15 segundos permanece fora do escopo.

## 2. Convenções de decisão
- **PASS:** evidência reprodutível em QA autorizado demonstra integralmente o resultado esperado, com identificação do conjunto de dados, versão, ambiente e logs.
- **FAIL:** qualquer violação de integridade, isolamento, contagem, atribuição ou restauração.
- **BLOCKED:** ambiente, contrato, acesso ou pré-requisito indisponível; não pode ser interpretado como PASS.
- **NOT RUN:** cenário não executado; **todos os casos abaixo estão NOT RUN nesta etapa**.
- **Crítico:** falha bloqueia qualquer aprovação e qualquer ação destrutiva.
- **Alto:** falha bloqueia promoção para produção e requer correção/revalidação.

**Regra global:** 100% de reconciliação dos eventos válidos e métricas elegíveis por empresa, TV, mídia, dia local, anunciante e campanha quando identificável; nenhuma duplicidade ou vazamento entre empresas. Ambiguidades de atribuição devem ser explicitadas e resolvidas antes de emitir prova individual.

## 3. Matriz de cenários e critérios objetivos

| ID | Criticidade | Cenário futuro em QA isolado | Critério PASS / evidência exigida | FAIL / bloqueio |
|---|---|---|---|---|
| D01 | **Crítico** | Reenvio do mesmo `(device_id, client_event_id)` | Uma única ocorrência lógica; métricas idênticas antes/depois; ledger ou recomputação auditável | Contagem duplicada ou evento perdido |
| D02 | **Crítico** | Timeout após persistência e ACK não recebido | Retry com mesma chave não duplica; confirmação durável identificável | ACK indevido, perda ou dupla contagem |
| D03 | **Crítico** | Dois lotes concorrentes com evento repetido | Resultado determinístico e idempotente sob concorrência; sem atualização parcial | Divergência entre execuções ou corrida |
| D04 | **Alto** | Reprocessar lote já agregado após reinício | Hash/contagens e partições equivalentes, sem incremento extra | Soma muda sem evento novo |
| O01 | **Crítico** | TV offline por vários dias e posterior sincronização | Todos os eventos válidos aparecem uma vez, com data de exibição correta; ACK só após persistência | Perda por antiguidade, fila apagada cedo ou duplicação |
| O02 | **Crítico** | Lote offline parcialmente recebido | Reenvio complementa apenas ausentes; rastreabilidade evento a evento | Lacuna ou duplicidade |
| O03 | **Alto** | Evento tardio em dia já agregado/arquivado | Partição reconciliada e versão atualizada; relatório/portal refletem correção | Dia histórico fica permanentemente incompleto |
| T01 | **Crítico** | TV inicia com relógio 1970 | Evento preservado com metadados de tempo; classificação pendente até validação, sem descarte silencioso | Evento excluído ou contabilizado em data falsa como fato |
| T02 | **Crítico** | TV com relógio futuro | Preservação e reconciliação sem antecipar corte de retenção | Evento descartado ou arquivado prematuramente |
| T03 | **Alto** | Fuso local e virada de dia | Dia local estável por estabelecimento, com timezone/versionamento e totais coerentes | Contagem no dia errado ou dupla contagem na fronteira |
| A01 | **Crítico** | Exportar e restaurar lote completo | Mesmo número de chaves/eventos, hashes válidos, campos originais e metadados preservados; relatório de restauração | Arquivo ausente, truncado, divergente ou irrestaurável |
| A02 | **Crítico** | Arquivo adulterado ou manifest incompatível | Falha detectada e bloqueio do lote; checksum e controle de acesso demonstrados | Arquivo aceito sem integridade comprovada |
| A03 | **Alto** | Restauração de arquivo de versão anterior | Esquema/versionamento reconhecidos; sem perda de campos críticos | Incompatibilidade silenciosa |
| A04 | **Crítico** | Falha no meio de exportação/arquivo | Nenhum raw marcado elegível para remoção até arquivo, conferência e cópia de recuperação completos | Elegibilidade antecipada ou perda de custódia |
| P01 | **Crítico** | `campaign_id = NULL` em reprodução publicitária | Regra histórica comprovada atribui corretamente ou mantém pendência explícita; nunca classifica NULL automaticamente como não anúncio | Prova omitida ou atribuída sem fundamento |
| P02 | **Crítico** | Campanha/anunciante alterados depois da exibição | Prova mantém associação válida no momento da reprodução e versão de atribuição | Reatribuição retroativa silenciosa |
| P03 | **Crítico** | Evento com vínculo ambíguo | Não é exibido como prova de anunciante específico sem resolução; permanece auditável | Contagem indevida para anunciante |
| P04 | **Crítico** | Anunciante de outra empresa consulta dados | Nenhum evento, agregado ou arquivo de outra empresa é acessível; controle de autorização demonstrado | Vazamento intertenant |
| R01 | **Crítico** | Relatório antes/depois do corte raw→agregado | Totais e métricas idênticos para mesmo conjunto de eventos; fronteira sem sobreposição | Perda ou dupla contagem |
| R02 | **Crítico** | `get_playback_report`, `get_playback_events` e portal | Contratos de filtros, períodos, timezone, contagem e paginação preservados ou migrados com consumidores validados | Painel/portal divergem ou falham |
| R03 | **Alto** | CSV/export e auditoria por evento histórico | Export corresponde à fonte canônica; detalhe original recuperável sob autorização | CSV incompleto ou impossível auditar |
| R04 | **Alto** | Última exibição e evento recebido tardiamente | Ordenação por instante de reprodução e atualização histórica coerentes | Indicador incorreto ou histórico inconsistente |
| R05 | **Crítico** | Reversão da consulta híbrida | Rollback planejado recupera relatório íntegro sem perder eventos novos | Reversão com lacunas ou indisponibilidade irrecuperável |
| S01 | **Alto** | Índices e desempenho | UNIQUE de idempotência preservada; planos de consulta e latência aceitável documentados | Constraint removida ou degradação incompatível |
| S02 | **Alto** | Capacidade e espaço físico | Medir separadamente linhas, heap, índices, bloat, database size e disco; sem presumir liberação imediata após DELETE | Economia declarada sem evidência ou manutenção bloqueante |
| G01 | **Crítico** | Tentativa de ativar retenção sem autorização | Nenhum job/DELETE/migração entra em produção; controle humano de aprovação registrado | Ação destrutiva sem aprovação explícita |

## 4. Conjuntos de dados sintéticos a preparar futuramente
Somente após autorização de QA: conjunto com IDs estáveis; eventos concluídos e iniciados; reenvios exatos; chaves distintas; mídia com e sem campanha; atribuições alteradas no tempo; empresas distintas; datas 1970/futuro; fuso e virada de dia; atraso de vários dias; lote parcial; falha de arquivo; manifest inválido. **Não criar nem executar esses conjuntos nesta etapa.**

## 5. Evidências mínimas de homologação futura
Para cada ID, registrar: executor autorizado, data, commit/build, ambiente isolado, dados sintéticos identificados, pré-condições, passos executados, esperado, observado, evidências anexadas, contagens/hashes, resultado PASS/FAIL/BLOCKED, responsável pela revisão e decisão. Sem esses campos, classificar **NOT RUN/BLOCKED**, nunca PASS.

## 6. Portas formais de aprovação
| Porta | Requisito | Decisão atual |
|---|---|---|
| 0 — Especificação | Matriz aprovada para leitura e revisão | **GO DOCUMENTAL** |
| 1 — Preparação QA | Responsável, isolamento, dados sintéticos, backup e autorização escrita | **NÃO AUTORIZADA** |
| 2 — Execução QA | Todos os cenários críticos PASS; altos PASS ou correção e repetição; zero divergência não resolvida | **NOT RUN / NO-GO** |
| 3 — Arquivo e relatórios | Restauração íntegra, reconciliação 100%, isolamento por anunciante e rollback comprovados | **NOT RUN / NO-GO** |
| 4 — Retenção em produção | Aprovação específica, política contratual, medição atual, backup/restauração, observabilidade e parada segura | **NO-GO** |

**Não existe aprovação por média de testes:** um único FAIL crítico ou BLOCKED crítico impede GO. Cenário NOT RUN não pode ser dispensado por resultado de outro.

## 7. Restrições de segurança operacional
Nenhuma exclusão de `playback_logs`, remoção de índices, `VACUUM FULL`, alteração de RPC, configuração de `pg_cron`, migração, deploy, assinatura de APK ou intervenção em TVs está autorizada. Não usar números históricos da issue #16 como medições atuais. O arquivo original e a prova do anunciante são prioritários à redução de armazenamento.

## 8. Registro de não execução
Foi criado apenas este documento Markdown na branch isolada. **Nenhum SQL, teste, limpeza, código, GitHub Actions, Supabase, produção, TV ou APK foi alterado.** O dossiê de polling experimental de 15 segundos permanece arquivado, sem reabertura.

**VEREDITO: MATRIZ DOCUMENTAL DEFINIDA; TODOS OS CENÁRIOS NOT RUN; NO-GO OPERACIONAL MANTIDO.**
