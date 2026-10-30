# Plano final de homologação em TV Box de bancada — Vision 15s

Data: 2026-10-30. Branch: `audit/playback-query-performance-20261030`. **Somente planejamento; nenhum teste físico, instalação, deploy ou acesso ao Supabase compartilhado autorizado.**

## Evidência existente
- GitHub Actions [run 41107305101](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41107305101), commit `8fe6d789`: **117 testes PASS, 0 FAIL, 0 SKIP**. Inclui rollback pendente, troca de token entre captura e ACK, resposta perdida e contagem simulada.
- `player.js` oficial continua em 5s. Polling de 15s, timeout de 8s e quarentena são propostas isoladas, não integradas em APK.
- Base documental: `adaptive-polling-bench-homologation-checklist-20261030.md` e `adaptive-polling-bench-readiness-review-20261030.md`.

## Veredito
**NO-GO** para produção. **BLOCKED** para execução em bancada até preparar build e backend isolados, definir comportamento de recuperação e obter autorização expressa. Testes de simulação anteriores não comprovam funcionamento em WebView ou gateway real.

## Matriz final de riscos
| Risco | Severidade | Evidência atual | Critério para liberar |
|---|---|---|---|
| Requisição nunca encerra após AbortSignal | Crítica | Quarentena impede sobreposição, mas bloqueia comandos indefinidamente | Recuperação comprovada sem segundo poll concorrente e sem efeitos tardios da sessão antiga |
| Resposta de screenshot_result perdida | Alta | Teste simulado não marca ACK incerto como confirmado | Reconciliação idempotente pelo command_id com servidor isolado, sem duplicar captura confirmada |
| Token muda durante captura/ACK | Alta | Teste simulado rejeita ACK obsoleto | Teste ponta a ponta com token A/B e isolamento de sessão |
| Reinicialização, resetPairing e boot offline | Alta | Simulações de timers e token; cache real não exercitado | 3 reinícios; mídia offline preservada; relógio 1970 não interrompe reprodução |
| Rollback durante consulta pendente | Alta | Simulado 15s→5s sem sobreposição | Prova em WebView de único scheduler e nenhuma consulta órfã |
| Latência de screenshot a 15s | Média | Intervalo de descoberta maior que 5s | SLA definido e p95/p99 reais aprovados |
| Economia de consultas | Média | Estimativa teórica 66,7% somente commands em idle | Métricas separadas de commands, heartbeat, manifest, acesso, mídia e ACK |

## Pré-requisitos de bancada — não executar nesta fase
1. Reservar **uma TV Box exclusivamente de testes**, desconectada de contas e TVs de clientes. Registrar modelo, Android, WebView, firmware e versão.
2. Criar **gateway/backend de teste separado** com dados fictícios e comandos de screenshot sintéticos. Não apontar para projetos Supabase compartilhados, tokens ou endpoints de produção.
3. Preparar **build experimental distinto** do APK oficial, em branch de homologação separada, somente após autorização. Manter versão atual de bancada para retorno e verificar assinatura/compatibilidade sem desinstalar ou afetar aparelhos em produção.
4. Instrumentar logs locais e contadores de comandos, erros, timeout, ACK, duplicação, p50/p95/p99 e tempo offline. Evitar telemetria adicional no Supabase de produção.
5. Definir **SLA aceitável** para tempo até screenshot, limite de indisponibilidade em quarentena e responsável por decisão de abortar teste.
6. Aprovar previamente rollback para baseline 5s com alternância mutuamente exclusiva de timers. Uma consulta não terminada **não** autoriza iniciar nova consulta no mesmo contexto.

## Roteiro sequencial para futura execução autorizada
| Fase | Ensaio | Evidência de aceite | Estado |
|---|---|---|---|
| 0 | Isolamento e baseline 5s | Ambiente sem vínculos com produção; mídia e comandos baseline | BLOCKED |
| 1 | 15s ocioso, 5s ativo, timeout 8s e backoff 30s | Um poll em voo, métricas de latência e contagem por tipo | BLOCKED |
| 2 | Captura única, comando repetido, ACK perdido e resposta tardia | Sem duplicação após confirmação; reconciliação servidor | BLOCKED |
| 3 | Wi-Fi oscilante, falha HTTP, transporte que ignora abort e que nunca termina | Quarentena e recuperação operacional sem sobreposição | BLOCKED |
| 4 | Cache offline, reboot sem rede, relógio 1970 e retorno online | Playlist reproduz e sincroniza sem perdas | BLOCKED |
| 5 | Token A/B, resetPairing, reinício durante captura | Nenhum ACK ou comando de sessão antiga aplicado | BLOCKED |
| 6 | Comparação 30–60 min em 5s vs 15s | Contagens commands e demais chamadas separadas; p95/p99 | BLOCKED |
| 7 | Rollback 15s→5s inclusive com poll pendente | Um timer, nenhum efeito obsoleto, cache e mídia intactos | BLOCKED |

## Protocolo de parada e rollback
- Parar ensaio imediatamente em caso de duplicação de screenshot confirmado, sobreposição de polls, vazamento entre tokens, interrupção de mídia offline ou ligação involuntária à produção.
- Preservar logs locais, registrar FAIL/BLOCKED e manter equipamento isolado.
- Não executar rollback que crie segundo poll enquanto a requisição antiga ainda puder produzir efeitos. Confirmar término/descarte seguro da sessão antes de ativar baseline.
- Não usar merge, deploy, atualização remota de TVs nem alteração de Supabase como mecanismo de ensaio.

## Critério GO/NO-GO
**GO apenas para avaliação posterior** quando fases 0–7 tiverem evidência PASS, bloqueios críticos resolvidos, latência aprovada e autorização expressa. Qualquer FAIL/BLOCKED crítico mantém **NO-GO**. Mesmo GO de bancada não autoriza produção automaticamente.

## Registro para execução futura
| Fase | Dispositivo | Versão/commit | Data/hora | PASS/FAIL/BLOCKED | Evidências |
|---|---|---|---|---|---|
| 0–7 | A definir | A definir | Não executado | BLOCKED | Nenhuma |

**Escopo de mudança desta entrega:** apenas este arquivo documental na branch de auditoria. Não tocar `player.js`, produção, Supabase compartilhado, TVs, APK ou publicação.
