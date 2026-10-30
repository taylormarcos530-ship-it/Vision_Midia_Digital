# ESPECIFICAÇÃO DOCUMENTAL — PRESERVAÇÃO DA PROVA DE VEICULAÇÃO (ISSUE #16)

**Vision Mídia Digital | 30/10/2026 | Especificação v1.0, não implementada**  
**Branch de documentação:** `audit/playback-query-performance-20261030`  
**Decisão:** **GO exclusivamente para especificação; NO-GO para SQL, testes, limpeza, migrações e produção.**

## 1. Escopo, fontes e invariantes

Fonte principal: [Issue #16](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/issues/16). Referência complementar: `docs/audit/issue-16-playback-retention-risk-decision-plan-20261030.md`. Esta especificação não declara estado atual do Supabase nem comprova implantação.

**Invariantes obrigatórias:**
1. Nenhuma reprodução válida recebida pode desaparecer da prova de veiculação por efeito de retenção, mudança de índice ou migração.
2. Cada evento lógico contribui **uma única vez** para cada métrica correspondente; reenvio offline não duplica contagem.
3. O vínculo histórico empresa–TV–mídia–anunciante é reconstituível, mesmo se a campanha ou associação mudar posteriormente.
4. O arquivo original é recuperável, verificável e acessível somente a quem tem autorização.
5. Painel, portal do anunciante, exportações e consultas por período devem manter consistência antes e depois de qualquer corte de retenção.
6. Sem evidência de homologação e autorização específica, **não executar exclusões nem alterar operações em produção**.

## 2. Modelo lógico proposto (não é DDL)

**Evento canônico:** `company_id`, `device_id`, `client_event_id`, identificador interno de evento, `media_id`, `playlist_id` quando disponível, `campaign_id` quando disponível, tipo de evento (iniciado/concluído), duração reportada, `started_at` (instante da reprodução), `created_at` (recebimento), origem, versão de formato, snapshot de associação e estado de validação. Os campos e sua disponibilidade real exigem conferência do esquema antes de implementação.

**Chave lógica de idempotência:** `(device_id, client_event_id)`, preservando a unicidade existente citada na issue. Eventos sem chave válida exigem tratamento explícito, sem deduplicação por horário aproximado.

**Agregado diário:** chave lógica proposta `(company_id, local_date, timezone_id, device_id, media_id, attribution_version, advertiser_id, campaign_id_or_sentinel, metric_schema_version)`. Armazenar iniciadas, concluídas, segundos comprovados, primeira e última reprodução, total de eventos fonte, marca de reconciliação, intervalo de ingestão e referência ao lote/versão. Não usar NULL de campanha como prova de ausência de publicidade.

**Regra de tempo:** `started_at` governa o dia exibido na prova; `created_at` governa janela de recebimento e elegibilidade para arquivamento. A zona local deve ser definida por estabelecimento e preservada no agregado; datas inválidas ou relógio 1970/futuro ficam em quarentena lógica para reconciliação, nunca descartadas silenciosamente.

## 3. Agregação idempotente e reconciliação

A implementação futura deverá:
- Registrar o evento canônico de forma idempotente, com resultado inequívoco para duplicatas.
- Gerar agregados por projeção determinística dos eventos canônicos, com checkpoints, versões e chave de agregação estável.
- Evitar atualização incremental não transacional que possa contabilizar o mesmo evento duas vezes após timeout, retry ou falha parcial.
- Usar ledger de eventos processados ou recomputação determinística de partições; escolher uma abordagem mediante revisão técnica e evidência de concorrência em QA.
- Tornar reprocessamento de lote seguro: **mesmo conjunto de entradas → mesmo resultado**, inclusive após reinício.
- Manter trilha para corrigir atribuição histórica sem perder o agregado anterior: registrar versão, justificativa e reconciliação; nunca reatribuir silenciosamente ao anunciante atual.
- Conferir contagens e segundos por dia, empresa, TV, mídia, campanha e anunciante, além do total global. Meta de aceite: **100% de reconciliação das métricas elegíveis**, com exceções explicitamente documentadas e bloqueadoras até resolução.

## 4. Arquivo restaurável do evento original

**Unidade de arquivo:** lotes fechados por faixa de `created_at`, empresa e identificador único de lote, com fronteiras não sobrepostas. Preservar payload canônico original, IDs, `client_event_id`, timestamps, snapshots, esquema e metadados de origem.

**Manifest de custódia:** ID do lote, intervalo, quantidade de eventos, quantidade de chaves únicas, bytes, versão do esquema, hash SHA-256 por arquivo e hash do manifest, data de geração, destino, criptografia, responsável e registro de restauração. Assinatura digital, se adotada, exige gestão de chaves separada; checksum sozinho não autentica o emissor.

**Condições antes de tornar raw elegível para exclusão futura:** arquivo íntegro, cópia de recuperação independente, permissão de leitura validada, restauração integral em QA isolado, confronto evento a evento e compatibilidade dos relatórios comprovados. Se falhar qualquer etapa, **retenção interrompida**.

**Segurança:** controle de acesso por empresa/função, criptografia em repouso e trânsito, gestão de chaves, logs de acesso, política de retenção aprovada conforme contrato/privacidade e procedimento de exclusão legal quando aplicável. Nenhum prazo fixado neste documento.

## 5. Eventos offline e ingestão tardia

A fila local da TV deve conservar eventos até confirmação válida de persistência; ACK de transporte isolado não deve equivaler automaticamente a confirmação durável. Ao reconectar:
1. Reenviar com a **mesma chave lógica**; servidor deduplica.
2. Validar `started_at` e `created_at` separadamente, sem eliminar eventos antigos por idade de reprodução.
3. Identificar relógio desajustado e preservar o valor recebido junto de evidências para reconciliação.
4. Atualizar ou recomputar a partição diária afetada com versionamento, mesmo quando o evento chega após o fechamento inicial.
5. Evitar corte de raw baseado exclusivamente em `started_at`; considerar `created_at`, atrasos reais e estado de reconciliação.
6. Garantir que a mesma reprodução não apareça simultaneamente como raw e agregado nos relatórios.

Casos obrigatórios de homologação futura: duplicata após perda de ACK, reenvio após dias offline, relógio 1970, relógio futuro, lote parcialmente recebido, reconexões repetidas e correção posterior de associação ao anunciante.

## 6. Atribuição histórica aos anunciantes

A prova deve usar vínculo **válido no momento da exibição**, não apenas a campanha atualmente ativa. Especificar uma fonte versionada de atribuição, incluindo empresa, TV, mídia, campanha opcional, anunciante, vigência, regras de exclusividade e evidência da decisão.

**`campaign_id = NULL` não implica “não anúncio”.** Esses eventos entram em estado de atribuição pendente ou são resolvidos por regras históricas comprovadas; não são eliminados dos totais por conveniência. Eventos com atribuição ambígua ficam sinalizados e não podem ser apresentados como comprovante de um anunciante específico sem resolução.

O portal de cada anunciante deve acessar apenas dados que lhe pertencem; agregação não pode enfraquecer RLS, escopo de empresa ou isolamento de credenciais.

## 7. Compatibilidade de relatórios, RPC e exportações

A issue identifica `get_playback_report` e `get_playback_events` como dependentes de `public.playback_logs`, e `app.js` como consumidor de `rpc/get_playback_report`. Qualquer solução futura deve preservar contratos de campos, filtros, ordenação, fuso, paginação e significado das métricas ou planejar migração versionada de consumidores.

**Consulta híbrida proposta:** eventos raw recentes + agregados históricos **sem sobreposição**. Definir fronteira de corte por partição/lote fechado e reconciliado; usar o raw para partições ainda abertas e agregado para partições arquivadas. Se houver evento tardio de partição arquivada, recalcular a versão histórica e invalidar cache/relatório afetado de forma rastreável.

Validar equivalência do painel, portal do anunciante, CSV, contadores de reprodução, última exibição e filtros por empresa/TV/mídia/campanha. Preservar a possibilidade de auditoria detalhada por evento mediante restauração ou consulta autorizada ao arquivo original. Não afirmar que agregado diário substitui automaticamente uma listagem individual.

## 8. Portas de decisão e critérios de aceite

| Porta | Evidência futura necessária | Estado nesta etapa |
|---|---|---|
| A — Contratos e atribuição | Definição formal de evento, anunciante, vigência, timezone e métricas | **Pendente** |
| B — Agregação | Prova de idempotência, concorrência, retries e reconciliação 100% | **NO-GO execução** |
| C — Arquivo | Manifest, hashes, controle de acesso e restauração integral isolada | **NO-GO execução** |
| D — Offline | Reenvio tardio, relógio incorreto, ACK perdido e fechamento reaberto sem perda | **NO-GO execução** |
| E — Relatórios | Equivalência painel/portal/CSV e isolamento entre anunciantes | **NO-GO execução** |
| F — Retenção | Política aprovada, backup, rollback, medição de espaço e autorização de produção | **NO-GO produção** |

**Critérios de parada:** qualquer evento válido perdido, duplicidade, atribuição indevida, divergência de relatório, arquivo irrestaurável, exposição entre empresas, ou impossibilidade de rollback. Uma aprovação de desenho não autoriza SQL, cron, testes ou limpeza.

## 9. Decisão e registro de não execução

A estratégia preferencial **para estudo futuro** é preservar eventos canônicos, consolidar por projeção idempotente, arquivar com restauração comprovada e consultar raw/agregados sem dupla contagem. Isso é **especificação, não implementação aprovada**.

Nenhum SQL, teste, DELETE, TRUNCATE, VACUUM, índice, cron, alteração de código, GitHub Actions, Supabase, produção, TVs ou APK foi executado. O dossiê arquivado de polling de 15 segundos não foi reaberto.

**VEREDITO: PROVA DE VEICULAÇÃO PRESERVADA COMO REQUISITO; NO-GO PARA ALTERAÇÃO OPERACIONAL.**
