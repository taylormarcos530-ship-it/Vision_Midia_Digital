# TERMO DE TRANSFERÊNCIA E CUSTÓDIA — AUDITORIA DO POLLING DE 15 SEGUNDOS

**Vision Mídia Digital | 30/10/2026 | Documento de custódia, não de implantação**

**Branch de custódia:** `audit/playback-query-performance-20261030`  
**Status técnico:** **NO-GO** para integração, merge, deploy, APK e produção.  
**Natureza:** transferência documental de conhecimento e evidências; **não altera permissões, propriedade, branch protection, PR, GitHub Actions ou sistemas operacionais**.

## 1. Responsabilidade e autoridade decisória
- **Responsável institucional por decisões futuras:** administração/titular autorizado da Vision Mídia Digital.
- **Custodiante documental:** administração da Vision, ou pessoa formalmente designada por ela em registro posterior. **Não há nomeação individual nova nem aceitação formal de custódia presumida por este termo.**
- **Responsável técnico por eventual homologação:** a designar expressamente antes da reabertura.
- **Autoridade para liberar produção:** exclusivamente responsável autorizado pela Vision, por ato futuro específico, após evidências de homologação; nenhuma autorização é concedida agora.
- **IA/automação/colaborador sem delegação expressa:** não pode interpretar este termo como autorização para merge, deploy, teste físico ou alteração do sistema.

## 2. Objeto da custódia
Preservar o conjunto documental e as fixtures de auditoria de polling experimental de 15s, mantendo a distinção entre evidência simulada e homologação real. O `player.js` oficial continua com polling de comandos a 5s. Não mover nem integrar código experimental.

## 3. Inventário e cadeia de evidências
| Item | Referência | Natureza / restrição |
|---|---|---|
| 117 testes aprovados | [GitHub Actions run 41107305101](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41107305101), commit `8fe6d7894575cd4f125ca9e70ef308efac6ebbc1` | Testes de simulação e banco local isolado; não comprovam WebView real |
| Plano de bancada | `docs/audit/adaptive-polling-final-bench-plan-117-tests-20261030.md` | Plano não executado |
| Alternativas para consulta travada | `docs/audit/permanently-stuck-command-poll-recovery-options-20261030.md` | Quarentena fail-closed e limites |
| Auditoria estática do gateway | `docs/audit/device-gateway-command-idempotency-session-static-audit-20261030.md` | Idempotência parcial, sessão/ACK tardio não comprovados |
| Constraints SQL | `docs/audit/device-command-screenshot-sql-constraints-static-review-20261030.md` | Unicidade, FK, CHECK e triggers não comprovados |
| Lacunas de SQL histórico | `docs/audit/final-historical-sql-ddl-evidence-gaps-20261030.md` | Migrações não integralmente recuperadas |
| Parecer final | `docs/audit/final-technical-opinion-adaptive-command-polling-15s-20261030.md` | Decisão NO-GO |
| Protocolo de encerramento | `docs/audit/closure-archive-protocol-15s-command-polling-20261030.md` | Critérios de arquivamento e prevenção de merge |
| Código de proposta | `tests/fixtures/adaptive-command-poller-proposal.mjs`, `abortable-command-poll-proposal.mjs`, `quarantined-command-poll-proposal.mjs`, `simulated-command-integration-proposal.mjs` | Exclusivamente experimental; não copiar para Player oficial sem autorização |

## 4. Estado das decisões
| Assunto | Estado |
|---|---|
| Arquivar evidências dos 117 testes como simulação | **Aprovado para documentação** |
| Preservar Player oficial com 5s | **Mantido** |
| Polling de 15s para produção | **Não autorizado — NO-GO** |
| Recuperação de consulta permanentemente travada | **Pendente de comprovação** |
| Idempotência completa por `command_id` e fencing de sessão | **Pendente** |
| UNIQUE, FK, CHECK e triggers no SQL | **Não comprovados documentalmente** |
| Homologação de TV Box de bancada | **Não autorizada nesta fase** |
| Merge, publicação, APK e TVs de produção | **Proibidos por escopo desta etapa** |

## 5. Condições cumulativas de reabertura
1. Solicitação formal e autorização expressa do responsável institucional, identificando objetivo, escopo, responsável técnico e limites.
2. Ambiente independente: TV Box de bancada, build experimental e gateway/backend com dados fictícios, sem apontar para Supabase compartilhado ou TVs de clientes.
3. Desenho de recuperação de requisição que ignora abort e nunca termina, sem duplicação de polls nem efeitos tardios.
4. Evidências de idempotência, reconciliação de ACK perdido, proteção de sessão antiga e consistência de upload/insert/status.
5. Revisão das definições SQL relevantes, distinguindo arquivos versionados de estado real aplicado; acesso a qualquer banco exige autorização própria.
6. Plano aprovado de testes em Android WebView, Wi-Fi intermitente, cache offline, relógio incorreto, auto-start, quiosque, rotação, latência e consumo por categoria.
7. Critérios mensuráveis de parada, GO/NO-GO e rollback 15s→5s, sem consultas concorrentes.
8. Autorização **separada e posterior** para qualquer integração ou produção, mesmo após eventual GO de bancada.

## 6. Checklist preventivo contra uso acidental
- [ ] Confirmar que o destino é a branch isolada, nunca a branch oficial.
- [ ] Confirmar que qualquer PR referente ao experimento está claramente identificado como **AUDITORIA / NO-GO / NÃO MERGEAR**; estado atual do PR não foi revalidado neste termo.
- [ ] Verificar manualmente que nenhum diff futuro altera `player.js`, gateway compartilhado, rotas oficiais, workflows de deploy, segredos ou configuração de TVs sem autorização específica.
- [ ] Não efetuar merge, cherry-pick, rebase para produção ou publicação de pacote experimental.
- [ ] Não gerar, assinar, distribuir ou instalar APK com a proposta de 15s.
- [ ] Não associar o experimento a dispositivos, tokens ou endpoints reais.
- [ ] Exigir revisão humana e autorização expressa documentada antes de qualquer transição de status.
- [ ] Confirmar rollback testado e evidências de bancada antes de considerar eventual integração.
- [ ] Tratar o checklist como **procedimento documental**, não como bloqueio técnico: nenhuma proteção de branch ou regra GitHub foi configurada nesta etapa.

## 7. Modelo de autorização futura (não preenchido)
**Solicitante:** [a definir]  
**Responsável autorizador Vision:** [a definir]  
**Responsável técnico:** [a definir]  
**Escopo exato:** [a definir]  
**Ambiente isolado e exclusões:** [a definir]  
**Evidências e critérios de aceite:** [a definir]  
**Plano de parada e rollback:** [a definir]  
**Data, decisão e registro verificável:** [a definir]  

**Sem preenchimento e autorização expressa, permanece NO-GO.**

## 8. Declaração de transferência
As referências, decisões, limitações e pendências ficam organizadas para custódia documental futura pela administração da Vision. **Não há declaração de aceite assinado, delegação de acesso, mudança de proprietário, transferência operacional nem liberação técnica.** A cadeia de evidências deve ser preservada na branch isolada até decisão futura.

## 9. Registro de não execução
Nesta etapa, somente este documento Markdown foi criado na branch de auditoria. **Nenhum teste, SQL, alteração de código, GitHub Actions, PR, branch protection, Supabase, produção, TV, APK, instalação ou publicação foi executado.**

**RESULTADO: CUSTÓDIA DOCUMENTAL PREPARADA; NO-GO MANTIDO.**
