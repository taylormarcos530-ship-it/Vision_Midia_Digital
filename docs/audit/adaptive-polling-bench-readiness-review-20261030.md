# Revisão de prontidão — homologação de bancada do polling 15s

Data: 2026-10-30. Base: `docs/audit/adaptive-polling-bench-homologation-checklist-20261030.md`. Evidência automatizada: GitHub Actions run 41106234903, **113/113 PASS**. **Esta revisão não executa testes adicionais.**

## Veredito
- **READY** para ampliar **simulações isoladas** no GitHub Actions, sem acesso a backend real.
- **NOT READY** para ensaio em TV Box: falta build isolado, gateway/backend de teste independente, instrumentação e autorização.
- **NO-GO** para produção, publicação, merge ou instalação.

## Classificação por ID
| Casos do checklist | Simulação isolada | TV Box de bancada / gateway isolado | Bloqueio |
|---|---|---|---|
| A1–A3 | A3: cálculo e gateway mock | A1, A2, A3: inventário, baseline e métricas reais | Ambiente de bancada ainda não preparado |
| B1–B5 | B1–B5: ACK/idempotência, perda de resposta, ordem e restart simulados | B1–B5: captura WebView e reconciliação ponta a ponta | B3/B5: reconciliação servidor ainda não demonstrada |
| C1–C5 | C1–C5: relógio/rede/timeout/quarentena simulados | C1/C2/C5: Wi-Fi, relógio e transporte reais; C3/C4 com gateway de falhas isolado | C4: consulta sem término não se recupera automaticamente |
| D1–D4 | D1–D4: testes de estado e cache mock | D1–D4: reprodução/cache WebView real, boot offline e retorno | Não há ensaio de mídia offline no hardware |
| E1–E4 | E1–E4: geração, token e timers simulados | E1–E4: restart/resetPairing real | Resposta tardia de sessão anterior não foi testada no player real |
| F1–F4 | F1–F3: contagem e latência em gateway mock; F4 com múltiplos clientes simulados | F1–F4: tráfego, p95/p99 e concorrência de dispositivos de bancada | Sem métricas observadas em rede real |
| G1–G5 | G1–G4: troca de modo e concorrência simuladas; G5: plano documental | G1–G4: rollback real com mídia; G5: autorização e responsável | G4: não liberar consulta concorrente durante rollback de requisição travada |

## Sequência recomendada sem tocar produção
1. **Agora:** ampliar testes isolados em CI para rollback durante consulta pendente, perda de ACK e mudança de token entre captura e confirmação. Instrumentar métricas simuladas por tipo de requisição.
2. **Antes de bancada:** definir SLA de screenshot, método de reconciliação idempotente no gateway isolado, comportamento operacional diante de transporte permanentemente travado, flag de rollback exclusiva e logs locais.
3. **Somente após autorização:** criar build/ambiente separados, testar em TV Box de bancada sem contas ou TVs de produção; registrar PASS/FAIL por caso.
4. **Somente depois:** revisão GO/NO-GO baseada em evidências e aprovação explícita antes de qualquer mudança oficial.

## Evidências e limites
- O Player oficial segue polling de comandos a 5 segundos; os 15 segundos estão somente em fixtures de auditoria.
- Economia ideal de consultas ociosas de comandos: 66,7%; **não** é economia global do Supabase.
- Testes simulados não substituem cache offline real, WebView, gateway ou comportamento de TV Box.
- Não alterar `player.js`, produção, Supabase compartilhado, TVs, APK ou deployment.

**Decisão final: READY para testes isolados; BLOCKED para bancada; NO-GO para produção.**
