# TERMO DE CONGELAMENTO DOCUMENTAL — DOSSIÊ POLLING 15 SEGUNDOS

**Vision Mídia Digital | 30/10/2026 | Versão documental 1.0 | NO-GO**

## 1. Finalidade
Estabelecer o marco documental de referência da auditoria do polling experimental de comandos a 15 segundos, preservando evidências e evitando que o arquivamento seja confundido com autorização de integração. Este termo não modifica o código, permissões ou estado de implantação.

**Branch de referência:** `audit/playback-query-performance-20261030`. **Status:** investigação documental encerrada, proposta experimental não homologada, **NO-GO para merge, deploy, APK, Supabase compartilhado e TVs de produção**.

## 2. Índice do dossiê congelado
| Nº | Documento | Função |
|---|---|---|
| 01 | `docs/audit/adaptive-polling-final-bench-plan-117-tests-20261030.md` | Plano de homologação não executado |
| 02 | `docs/audit/permanently-stuck-command-poll-recovery-options-20261030.md` | Riscos de transporte travado |
| 03 | `docs/audit/device-gateway-command-idempotency-session-static-audit-20261030.md` | Revisão estática de gateway, token e ACK |
| 04 | `docs/audit/device-command-screenshot-sql-constraints-static-review-20261030.md` | Evidências e lacunas de constraints |
| 05 | `docs/audit/final-historical-sql-ddl-evidence-gaps-20261030.md` | Encerramento de busca DDL |
| 06 | `docs/audit/final-technical-opinion-adaptive-command-polling-15s-20261030.md` | Parecer técnico e NO-GO |
| 07 | `docs/audit/closure-archive-protocol-15s-command-polling-20261030.md` | Protocolo de encerramento |
| 08 | `docs/audit/custody-transfer-term-15s-command-polling-20261030.md` | Custódia e autorização futura |
| 09 | `docs/audit/final-consistency-review-unified-go-no-go-15s-20261030.md` | Matriz única de decisão |
| 10 | **Este termo** `docs/audit/documentary-freeze-term-15s-command-polling-20261030.md` | Marco de referência e controle de versões |

**Evidência automatizada histórica:** [GitHub Actions run 41107305101](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41107305101), commit `8fe6d7894575cd4f125ca9e70ef308efac6ebbc1`: 117 testes PASS em simulações isoladas; não demonstra homologação real. Os documentos acima devem ser consultados na branch isolada; a referência do conjunto fica fixada pelo commit que criou este termo.

## 3. Decisões preservadas
- Baseline oficial de `player.js`: polling de comandos a **5 segundos**.
- Intervalo experimental de **15 segundos**: somente fixtures e documentação de auditoria.
- Economia teórica de **66,7%**: exclusivamente para taxa de consultas ociosas de comandos em regime contínuo; não representa economia total de Supabase.
- Quarentena fail-closed: orientação conservadora, mas sem solução comprovada para transporte que nunca encerra.
- Idempotência de screenshots, ACK tardio, fencing de sessão, UNIQUE/FK/CHECK/triggers: evidências incompletas.
- **GO exclusivamente documental. NO-GO para bancada sem autorização; NO-GO para integração e produção.**

## 4. Controle de versões e integridade documental
1. Este termo define **versão documental 1.0** do índice e das decisões, sem modificar nem substituir os documentos existentes.
2. Qualquer correção futura deverá ter identificação de versão, data, autor/autorizador, justificativa, arquivos afetados e referência ao commit anterior.
3. Preservar os registros históricos; não reescrever resultados de testes, não renomear simulação como homologação, não apagar limitações.
4. Novo resultado técnico não revoga automaticamente o NO-GO: exigir deliberação específica e autorização expressa.
5. Não criar tag de release nem tratar o commit de arquivamento como versão de software.
6. **Congelamento documental é uma regra de governança, não bloqueio técnico do GitHub.** Nenhuma proteção de branch, PR ou workflow foi configurada por este termo.

## 5. Condições para reabertura excepcional
- Solicitação escrita da administração/titular autorizado da Vision, com objetivo, responsável técnico designado e escopo.
- Separação explícita entre reabertura **documental**, ensaio em bancada e integração de produção; cada uma exige autorização própria.
- Plano de isolamento, dados fictícios, testes de recuperação de poll travado, idempotência e sessão antiga, verificação SQL e rollback sem consultas sobrepostas.
- Critérios GO/NO-GO objetivos, evidências rastreáveis e decisão formal posterior.
- Na ausência de qualquer condição, **manter arquivado e NO-GO**.

## 6. Checklist de proteção contra uso acidental
- [ ] A referência consultada pertence à branch de auditoria, não à branch de produção.
- [ ] O material está identificado como **EXPERIMENTAL / NÃO HOMOLOGADO / NÃO MERGEAR**.
- [ ] Não há autorização presumida para copiar fixtures ao `player.js`, gateway ou APK.
- [ ] Nenhum documento está sendo usado como substituto de resultado de teste em TV Box real.
- [ ] PR, regras de branch e workflows não são presumidos protegidos sem verificação e autorização específicas.
- [ ] Qualquer proposta de execução futura apresenta responsável, ambiente isolado, critérios de parada e rollback.
- [ ] Qualquer mudança de status possui aprovação expressa da administração da Vision.

## 7. Registro de custódia e não execução
Responsável institucional por decisão futura: **administração/titular autorizado da Vision Mídia Digital**. Responsável técnico e aceite individual de custódia: **a designar**, sem presunção de assinatura.

Este ato cria **somente este arquivo Markdown na branch isolada**. Não foram executados SQL, testes, builds, merge, deploy, alterações de código, GitHub Actions, branch protection, PR, Supabase, TVs ou APK.

**DECISÃO FINAL DO MARCO: DOSSIÊ DOCUMENTAL CONGELADO COMO REFERÊNCIA; NO-GO TÉCNICO MANTIDO.**
