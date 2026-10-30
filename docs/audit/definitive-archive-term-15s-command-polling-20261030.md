# TERMO DE ARQUIVAMENTO DEFINITIVO — DOSSIÊ DO POLLING EXPERIMENTAL DE 15 SEGUNDOS

**Vision Mídia Digital — 30 de outubro de 2026**  
**Classificação:** ARQUIVADO DOCUMENTALMENTE · EXPERIMENTAL · NÃO HOMOLOGADO · **NO-GO PARA INTEGRAÇÃO E PRODUÇÃO**  
**Repositório:** `taylormarcos530-ship-it/Vision_Midia_Digital`  
**Branch de preservação:** `audit/playback-query-performance-20261030`

## 1. Declaração de encerramento
Fica **definitivamente encerrada a fase documental** da investigação do polling experimental de comandos a cada 15 segundos, preservando o acervo e suas limitações. O encerramento não equivale a aprovação técnica, conclusão de homologação, autorização de execução ou aceitação de riscos para produção.

A configuração oficial do Player permanece com polling de comandos de 5 segundos. A proposta de 15 segundos continua restrita ao material experimental da branch de auditoria. **É vedada sua reativação, integração, distribuição ou publicação sem nova autorização expressa e independente.**

## 2. Referências arquivadas e cadeia de custódia
O índice de referência é o `docs/audit/documentary-freeze-term-15s-command-polling-20261030.md` (versão documental 1.0, commit `adf4b503240284668878d467bc547f7a32234cd7`), que relaciona os dez documentos do dossiê.

Documentos decisórios centrais:
- `docs/audit/final-technical-opinion-adaptive-command-polling-15s-20261030.md` — parecer final, riscos e NO-GO.
- `docs/audit/closure-archive-protocol-15s-command-polling-20261030.md` — encerramento, inventário e critérios.
- `docs/audit/custody-transfer-term-15s-command-polling-20261030.md` — custódia e autoridade decisória.
- `docs/audit/final-consistency-review-unified-go-no-go-15s-20261030.md` — interpretação única das decisões.
- `docs/audit/documentary-freeze-term-15s-command-polling-20261030.md` — índice congelado e controle de versões.

Evidência histórica de referência: GitHub Actions run `41107305101`, commit `8fe6d7894575cd4f125ca9e70ef308efac6ebbc1`: **117 testes aprovados em ambiente simulado/isolado**. Esse registro não demonstra validação em TV Box real nem autoriza execução futura. Não foram repetidos testes neste arquivamento.

## 3. Custódia e responsabilidades
- **Custodiante institucional previsto:** administração/titular autorizado da Vision Mídia Digital.
- **Responsável por decisão de reabertura:** titular/representante expressamente autorizado da Vision.
- **Responsável técnico futuro:** a designar antes de qualquer homologação.
- **Aceite formal de custódia:** não coletado por este documento; nenhuma assinatura, delegação, transferência de propriedade ou mudança de permissões é presumida.
- **Regra de preservação:** manter registros, commits, limitações e histórico rastreáveis; não substituir evidência anterior silenciosamente.

## 4. Decisão definitiva desta fase
| Assunto | Decisão |
|---|---|
| Encerramento e preservação documental | **APROVADO — ARQUIVADO** |
| 117 testes de simulação | **EVIDÊNCIA PRESERVADA**, não homologação |
| Polling oficial de 5 segundos | **PRESERVADO** |
| Polling experimental de 15 segundos em produção | **NO-GO** |
| Merge, deploy, release, APK, TVs e backend compartilhado | **NÃO AUTORIZADOS** |
| Homologação em bancada | **NÃO AUTORIZADA NESTA FASE** |
| Riscos críticos de transporte, ACK, sessão e SQL | **PENDENTES / NÃO ACEITOS PARA PRODUÇÃO** |
| Reabertura excepcional | **SOMENTE MEDIANTE AUTORIZAÇÃO FUTURA EXPRESSA** |

## 5. Reabertura excepcional: condições cumulativas
A reabertura **não é automática**. Exige:
1. Pedido escrito da administração da Vision, com justificativa, escopo delimitado, autorizador identificado e responsável técnico designado.
2. Identificação da versão documental anterior e criação de registro de reabertura separado, preservando este termo e os commits históricos.
3. Separação de permissões por fase: revisão documental, preparação de bancada, testes isolados e eventual produção são **autorizações distintas**.
4. Antes de qualquer teste: isolamento de TV Box, build e gateway/backend com dados fictícios, sem Supabase compartilhado nem dispositivos de clientes.
5. Plano de prova para recuperação de requisição que ignora cancelamento, não sobreposição de polls, idempotência/ACK perdido, proteção de sessão antiga, constraints SQL, cache offline, WebView e rollback seguro 15s→5s.
6. Critérios mensuráveis de interrupção e GO/NO-GO, evidências registradas e aprovação humana expressa. Mesmo um eventual GO de bancada **não libera produção**.

Sem todos os requisitos aplicáveis à fase pretendida, permanece **NO-GO**.

## 6. Proteção contra reativação ou publicação acidental
Checklist obrigatório antes de qualquer manuseio futuro:
- [ ] Confirmar que o material está na branch isolada e identificado como **AUDITORIA / ARQUIVADO / NO-GO / NÃO MERGEAR**.
- [ ] Não copiar fixtures para `player.js`, gateway oficial, branch principal ou pipeline de distribuição.
- [ ] Não fazer merge, cherry-pick, rebase para produção, criar release ou gerar/assinar/distribuir APK.
- [ ] Não vincular endpoints, credenciais, tokens ou TVs reais ao experimento.
- [ ] Não considerar os 117 testes de simulação como aprovação de bancada.
- [ ] Não presumir que PR em rascunho, branch protection ou bloqueios de deploy estejam efetivamente ativos sem verificação autorizada.
- [ ] Exigir autorização humana específica e revisão do diff para qualquer reabertura técnica.
- [ ] Em caso de dúvida sobre autorização ou integridade da cadeia documental, **interromper a ação e manter NO-GO**.

**Limite essencial:** este termo é uma salvaguarda administrativa/documental, **não instala travas técnicas no GitHub**. O estado atual de proteções de branch e PR não foi verificado nem alterado. A preservação do dossiê não depende de modificar o sistema em operação.

## 7. Registro de encerramento e não execução
**Resultado:** dossiê de polling de 15 segundos **arquivado definitivamente quanto à fase documental**, sem eliminar a possibilidade de reabertura excepcional autorizada. Nenhuma decisão anterior de NO-GO foi revogada.

**Alteração permitida e realizada nesta etapa:** criação exclusiva deste documento Markdown na branch isolada. **Não** foram executados testes, SQL, builds, deploys, merge, alterações de código, GitHub Actions, Supabase, produção, TVs, APK, PR ou configurações de proteção.

**TERMO FINAL: ENCERRAMENTO DOCUMENTAL DEFINITIVO · CUSTÓDIA INSTITUCIONAL PREVISTA · NO-GO TÉCNICO MANTIDO.**
