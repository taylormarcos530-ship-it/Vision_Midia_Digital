# ISSUE #16 — ANÁLISE DE RISCOS E PLANO DE DECISÃO DOCUMENTAL PARA RETENÇÃO DE PLAYBACK

**Vision Mídia Digital | 30/10/2026 | Documento exclusivamente de decisão**  
**Branch isolada:** `audit/playback-query-performance-20261030`  
**Fonte principal:** [Issue #16 — Histórico de reproduções, retenção, arquivo e crescimento seguro](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/issues/16)  
**Decisão atual:** **NO-GO para limpeza, exclusão, alteração de índices, agendamento de retenção e migração em produção.**

## 1. Escopo e limites de evidência
A análise usa somente registros já existentes no GitHub. O diagnóstico da issue é de **28/10/2026**, não constitui medição atual. Não foram consultados Supabase, TVs, SQL, métricas em tempo real nem outros sistemas. O dossiê de polling experimental de 15 segundos permanece **arquivado e fora do escopo**.

## 2. Base histórica da issue #16
- Banco ~**178 MB**, frente à cota de referência Free de **500 MB**; `public.playback_logs` ~**151 MB**: **41 MB heap + 110 MB em 12 índices**.
- ~**163.900 eventos**; ~**95.500** com `created_at` anterior a sete dias, ~**24.700** anteriores a 14 dias e **101** anteriores a 30 dias. Esses valores são do registro histórico e **não representam volume elegível para exclusão**.
- Em 27/10, **15.691 novos registros** de nove TVs distintas; variabilidade impede previsão linear confiável.
- **2.106 eventos** com diferença superior a um dia entre `created_at` e `started_at`; **88** recebidos recentemente com `started_at` superior a 30 dias. Esses casos são relevantes para filas offline e relógio incorreto.
- `get_playback_report` e `get_playback_events` calculam resultados a partir de `public.playback_logs`; `app.js` chama `rpc/get_playback_report`.
- `campaign_id IS NULL` não prova ausência de vínculo com anunciante.
- `pg_cron` existia no diagnóstico, mas **nenhum job de retenção estava ativo**. Não presumir que isso continue igual.
- `idx_scan=0` em uma amostra não demonstra que um índice seja dispensável. A constraint UNIQUE `device_id_client_event_id` protege idempotência.

## 3. Matriz de riscos e salvaguardas
| Risco | Impacto | Probabilidade sem validação | Salvaguarda documental obrigatória |
|---|---|---|---|
| Excluir raw antes de adaptar RPCs, painel e portal | **Crítico**: histórico/contagens desaparecem | Plausível | Proibir DELETE até consultas híbridas verificadas e restauração comprovada |
| Agregar sem atribuição correta ao anunciante | **Crítico**: prova de veiculação incorreta | Plausível | Reconciliar TV, mídia, empresa, campanha quando existente e regra de atribuição histórica; tratar NULL sem descarte |
| Descartar registros tardios da fila offline | **Alto**: perda de reproduções reais | Confirmado risco pelos atrasos históricos | Distinguir `created_at` (recebimento) e `started_at` (exibição); janela de reconciliação e deduplicação |
| Duplicar contagem na união raw + agregados | **Alto** | Plausível | Fronteira de corte estável, chave idempotente e reconciliação 100% por TV/mídia/campanha/dia |
| Arquivo sem recuperação verificável | **Crítico** | Desconhecida | Manifest, checksum, IDs originais, controle de acesso e ensaio real de restauração em QA |
| Apagar índice usado por idempotência/relatórios | **Alto** | Plausível | Preservar UNIQUE e índices críticos; exigir planos de consulta e revisão de dependências |
| Supor que DELETE libera imediatamente espaço físico | **Alto**: manutenção arriscada sem ganho previsto | Plausível | Separar linhas removidas, heap, índices, bloat, VACUUM/autovacuum; não usar VACUUM FULL em produção sem janela aprovada |
| Crescimento da base e custos associados | **Alto** | Variável | Acompanhar database size, disco, Storage, egress, Edge e crescimento por TV; alertas graduais |
| Expor dados no arquivo de longo prazo | **Alto** | Desconhecida | Acesso mínimo, criptografia, prazo definido por contrato/privacidade, trilha de auditoria |

A classificação de probabilidade é qualitativa e não decorre de teste novo.

## 4. Opções e decisão comparativa
| Alternativa | Integridade da prova | Economia potencial | Decisão agora |
|---|---|---|---|
| Manter raw sem exclusão e monitorar | Preserva evidência existente | Nenhuma redução automática | **GO documental como baseline conservador** |
| Agregados idempotentes + arquivo verificável + consultas híbridas | Potencialmente preserva, se comprovado em QA | Pode reduzir pressão futura | **GO apenas para desenho documental; NO-GO execução** |
| Excluir raw após N dias sem adaptação de relatórios | Rompe histórico | Incerta | **REJEITAR** |
| Excluir índices com `idx_scan=0` isolado | Risco de regressão e duplicação | Incerta | **REJEITAR** |
| Ativar `pg_cron` de limpeza sem rollback/restauração | Risco de perda automatizada | Incerta | **REJEITAR** |

## 5. Plano de decisão por portas — nenhuma execução autorizada
**Porta D0 — Requisitos de negócio e prova:** documentar obrigação de retenção, quem consulta relatórios, janela de prova por anunciante, dados de atribuição e exigências contratuais/privacidade. **GO apenas para documentação**.

**Porta D1 — Arquitetura proposta:** desenhar agregados imutáveis/incrementais por data local, empresa, TV, mídia e campanha quando disponível, contagens iniciadas/concluídas, segundos e primeira/última reprodução; preservar IDs e versões de atribuição. Especificar fronteira raw/agregado sem dupla contagem e ingestão tardia. **GO apenas para revisão de desenho**.

**Porta D2 — Arquivo íntegro:** definir exportação em lotes, compressão, checksum, manifest, proteção de acesso, IDs, snapshots, `client_event_id`, `started_at`, `created_at` e restauração reproduzível. **NO-GO até prova de restauração em QA autorizado**.

**Porta D3 — Homologação independente:** somente após autorização separada, usar dados sintéticos/isolados; comparar relatório/portal/export antes e depois; exigir **100% de reconciliação** por dia/TV/mídia/campanha, eventos tardios, NULL e deduplicação; verificar desempenho e rollback. **Não autorizada nesta etapa**.

**Porta D4 — Política de retenção:** comparar cenários **7/14/30 dias** de raw online, **12 meses** de agregados e prazo contratualmente adequado para arquivo (90 dias é apenas exemplo da issue, não regra aprovada). Definir corte com base em recebimento e proteção de filas offline. **Nenhum prazo ativado**.

**Porta D5 — Liberação excepcional:** somente com backup e restauração aprovados, compatibilidade de RPCs/portal comprovada, revisão de índices, medição de espaço físico e aprovação expressa da administração da Vision. Uma autorização de QA **não** autoriza DELETE, VACUUM FULL ou cron em produção.

## 6. Critérios objetivos de GO/NO-GO
**GO para análise documental:** manter baseline, registrar métricas históricas e preparar decisão sem alterar sistemas.

**NO-GO imediato para qualquer ação destrutiva** se houver: divergência de contagem; arquivo sem checksum ou restauração; perda de vínculo anunciante; fila offline não reconciliada; dependência de RPC antiga não adaptada; ausência de rollback; risco à UNIQUE de idempotência; falta de autorização explícita; ou uso de números históricos como medição atual.

**GO técnico futuro em QA:** exige isolamento, autorização específica, casos sintéticos de relógio incorreto e fila tardia, 100% de reconciliação, export/restauração e relatórios sem regressão.

**GO para produção:** não concedido; requer deliberação posterior, medição atual, backup verificável e aprovação específica.

## 7. Alertas e projeção — somente proposta
Avaliar faixas de alerta em **60% / 75% / 85%** da capacidade de referência, além de crescimento diário, pico por horário e cenários de 10/20/30 TVs. **Não configurar alertas nem projetar prazo de esgotamento com base em um único dia.** Diferenciar cota de database size, disco, Storage, egress e invocações Edge.

## 8. Evidências de código citadas na issue
- `supabase/migrations/20260908025620_add_playback_report_rpc.sql`
- `supabase/migrations/20260908025854_add_playback_export_rpc.sql`
- `supabase/functions/device-gateway/index.ts`
- [Issue #14 — multiplicação de chamadas](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/issues/14)
- [PR #15 — redução de gravações em QA](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/pull/15)

Referências citadas pela issue, sem execução ou verificação do estado implantado.

## 9. Registro de não execução
Nesta etapa foi criado **somente este documento Markdown na branch isolada**. Nenhum SQL, teste, DELETE, TRUNCATE, DROP INDEX, VACUUM, cron, backup, alteração de código, GitHub Actions, Supabase, produção, TV ou APK foi executado. O dossiê arquivado de polling de 15 segundos não foi reaberto.

**VEREDITO: PRESERVAÇÃO DE PROVA DE VEICULAÇÃO É CONDIÇÃO INEGOCIÁVEL; NO-GO PARA RETENÇÃO/EXCLUSÃO EM PRODUÇÃO ATÉ HOMOLOGAÇÃO E AUTORIZAÇÃO.**
