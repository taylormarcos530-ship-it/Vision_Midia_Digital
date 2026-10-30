# PARECER CONSOLIDADO DE GO/NO-GO DOCUMENTAL — ISSUE #16

**Vision Mídia Digital — 30/10/2026**  
**Objeto:** retenção, crescimento e preservação da prova de veiculação em `playback_logs`  
**Natureza:** parecer exclusivamente documental, sem execução técnica  
**Branch:** `audit/playback-query-performance-20261030`  
**Conclusão:** **GO para encerramento desta etapa documental; NO-GO para SQL, testes, limpeza, retenção automatizada, alteração de índices, integração e produção.**

## 1. Base de evidências examinada
Documentos existentes e conferidos nesta mesma branch:

1. [Análise de riscos e plano de decisão](./issue-16-playback-retention-risk-decision-plan-20261030.md).
2. [Especificação de preservação da prova de veiculação](./issue-16-playback-proof-preservation-specification-20261030.md).
3. [Matriz de critérios de aceite e reprovação](./issue-16-playback-proof-acceptance-rejection-matrix-20261030.md).
4. [Issue #16 — diagnóstico histórico de retenção e crescimento](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/issues/16).

Não houve consulta ao Supabase ou aos dispositivos; os números da issue são fotografia documental de **28/10/2026**, não medições atuais.

## 2. Síntese factual e limites
A issue documenta aproximadamente **178 MB** de banco, dos quais **151 MB** em `public.playback_logs` e índices (41 MB heap e 110 MB em 12 índices), cerca de **163.900 eventos** e diferenças relevantes entre `created_at` e `started_at`. Esses números justificam planejar capacidade, mas **não** autorizam excluir registros nem predizem a situação atual.

As RPCs `get_playback_report` e `get_playback_events` dependem historicamente dos eventos brutos; remover dados sem adaptar e validar consumidores ameaça painel, portal e exportações. A presença de `campaign_id = NULL` não permite concluir que um evento não pertence a anunciante. A chave única por TV e evento protege idempotência e não deve ser removida por avaliação superficial de índices.

## 3. Parecer de riscos
| Tema | Risco determinante | Conclusão |
|---|---|---|
| Exclusão de raw | Histórico pode desaparecer de RPCs, portal e exportações | **NO-GO** sem consulta híbrida validada |
| Agregação | Dupla contagem, falha concorrente ou perda em retry | **NO-GO** sem idempotência demonstrada |
| Arquivo | Perda definitiva se não for íntegro e restaurável | **NO-GO** sem manifest, checksum, controle de acesso e restauração |
| Offline e relógio | Eventos tardios podem ser eliminados ou atribuídos ao dia errado | **NO-GO** sem reconciliação de `started_at`/`created_at` |
| Atribuição | `campaign_id` ausente ou associação alterada pode gerar prova incorreta | **NO-GO** sem vínculo histórico versionado |
| Índices e espaço | Remoção indevida de UNIQUE; DELETE sem ganho físico imediato | **NO-GO** sem avaliação e medição autorizadas |
| Privacidade e isolamento | Exposição cruzada de dados de anunciantes/empresas | **NO-GO** sem autorização e segregação comprovadas |

## 4. Arquitetura aprovada somente como referência de estudo
O desenho documental preferencial é: **evento canônico preservado → agregação determinística/idempotente → arquivo original íntegro e restaurável → consultas híbridas raw/agregados com fronteira não sobreposta → reconciliação de atrasos offline → prova histórica vinculada ao anunciante correto**.

Essa sequência **não** constitui autorização para criar tabelas, migrar RPCs, executar SQL, ativar cron ou eliminar registros. A definição final do esquema, das regras de atribuição, da retenção e dos controles de privacidade depende de revisão e aprovação futuras.

## 5. Consolidação da matriz de aceite
A matriz estabelece **25 cenários planejados**, distribuídos em duplicidade/idempotência (D01–D04), offline (O01–O03), relógio/fuso (T01–T03), arquivo/restauração (A01–A04), anunciante/isolamento (P01–P04), relatórios (R01–R05), espaço/índices (S01–S02) e autorização (G01).

**Estado de todos os cenários: NOT RUN.** Nenhum PASS técnico é alegado.

Requisitos futuros não negociáveis:
- **100% de reconciliação** dos eventos válidos e métricas elegíveis por empresa, TV, mídia, data local, anunciante e campanha quando identificável.
- Nenhum evento válido perdido, duplicado ou atribuído a anunciante incorreto.
- ACK durável e retries idempotentes, incluindo fila offline tardia, falha parcial e relógio incorreto.
- Arquivo original com integridade verificável, restauração integral em ambiente isolado e rastreabilidade.
- Equivalência de painel, portal, CSV, relatórios e filtros, com isolamento entre empresas.
- Preservação da UNIQUE de idempotência e rollback comprovado.

**Um FAIL crítico, BLOCKED crítico ou cenário crítico NOT RUN impede GO técnico.** Critérios de aceite são condições futuras, não resultados de homologação.

## 6. Matriz de decisão final
| Atividade | Decisão | Justificativa |
|---|---|---|
| Registrar riscos, arquitetura e critérios de aceite | **GO DOCUMENTAL** | Três peças coerentes e verificadas na branch |
| Arquivar este parecer como referência de decisão | **GO DOCUMENTAL** | Não modifica sistemas nem concede permissões |
| Executar testes ou SQL em QA | **NO-GO NESTA SOLICITAÇÃO** | Exige autorização expressa, isolamento e plano próprio |
| Criar agregados, arquivos ou alterar RPCs | **NO-GO** | Não homologado e fora do escopo documental |
| Excluir raw, remover índices, executar VACUUM FULL ou agendar cron | **NO-GO** | Risco à prova, integridade e disponibilidade |
| Alterar código, GitHub Actions, Supabase, produção, TVs ou APK | **NO-GO** | Expressamente proibido |
| Aprovar retenção em produção | **NO-GO** | Sem medição atual, homologação, restauração, rollback e autorização específica |

## 7. Condições para eventual nova deliberação
Qualquer avanço técnico futuro requer **novo pedido e autorização expressa**, com responsável identificado, ambiente QA isolado, definição contratual de retenção e privacidade, dados sintéticos, plano de rollback, matriz integralmente executada e aprovada, restauração comprovada e compatibilidade de relatórios. Uma futura aprovação de QA **não** equivale a aprovação de produção.

## 8. Coerência entre as três peças
- **Análise de riscos:** recomenda preservar raw e rejeita limpeza sem provas.
- **Especificação:** define as invariantes técnicas necessárias para preservar eventos, atribuição e consultas.
- **Matriz:** transforma invariantes em critérios objetivos de PASS/FAIL/BLOCKED/NOT RUN.
- **Parecer:** não transforma requisitos futuros em testes realizados, não afirma economia efetiva e não confunde documentação com homologação.

Não foi identificada contradição material entre as decisões centrais dessas três peças. A verificação de consistência **não é auditoria de código nem certificação de ambiente**.

## 9. Proteção de escopo e registro de não execução
O dossiê experimental de polling de 15 segundos permanece **definitivamente arquivado**, não reaberto nem utilizado para justificar alterações.

Nesta etapa foi criado **somente este arquivo Markdown** na branch isolada. Não foram executados SQL, testes, limpeza, exclusão, migrações, builds, deploys, merge ou alterações de código, GitHub Actions, Supabase, produção, TVs ou APK.

**PARECER FINAL: GO PARA DOCUMENTAÇÃO CONSOLIDADA DA ISSUE #16; NO-GO PARA QUALQUER EXECUÇÃO OU PUBLICAÇÃO.**
