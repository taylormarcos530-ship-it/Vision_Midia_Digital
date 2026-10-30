# Checklist de homologação de bancada — polling experimental 15s

Data: 2026-10-30 | Escopo: branch `audit/playback-query-performance-20261030` | Estado: **PLANEJADO / NÃO EXECUTADO**.

## Premissas e bloqueios
- Evidência automatizada anterior: GitHub Actions [execução 92](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41106234903), **113/113 PASS**. São testes simulados, não homologação em hardware.
- **Não instalar nem publicar** código, APK ou mudanças no player oficial. Não acessar Supabase compartilhado, nem usar TVs em produção. Qualquer ensaio físico futuro exige autorização expressa, dispositivo de bancada isolado e backend de teste independente.
- O `player.js` oficial permanece com polling de comandos a **5s**. Os 15s são somente proposta em fixtures de testes. Não afirmar que 15s já está funcionando no APK.
- Antes de executar os casos abaixo, providenciar build de homologação e backend isolados, plano de captura de logs locais e controle de rollback; nada disso está autorizado nesta etapa.
- Registrar por caso: data, versão/commit, aparelho e WebView, ambiente isolado, rede, hora de início/fim, evidências (logs locais e vídeo), contagem de consultas e resultado PASS/FAIL/BLOCKED.

## Checklist de execução (não marcar como PASS sem evidência)
### A. Linha de base
- [ ] A1. Identificar versão do Player/APK e configuração de bancada; confirmar **não produção**.
- [ ] A2. Validar playlist e captura no baseline de 5s, sem alterar cache.
- [ ] A3. Medir 30 min de comandos em ociosidade com contagem do gateway isolado; registrar intervalo observado, p50/p95 de latência e erros.

### B. Captura de tela e idempotência
- [ ] B1. Emitir um único comando screenshot; verificar captura, `screenshot_result`, ACK persistido e conclusão no servidor isolado.
- [ ] B2. Reentregar mesmo `command_id`; exigir **zero capturas adicionais** após ACK confirmado.
- [ ] B3. Simular perda da resposta HTTP de `screenshot_result`; verificar reconciliação pelo estado servidor antes de qualquer repetição. **Não tratar resposta incerta como erro confirmado**.
- [ ] B4. Enviar comandos distintos consecutivos; verificar ordem, ausência de sobreposição e limite de latência acordado.
- [ ] B5. Repetir com reinicialização entre captura e ACK; não duplicar imagem nem marcar comando incorretamente.

### C. Conexão instável e consultas travadas
- [ ] C1. Desligar/religar rede durante polling; garantir uma consulta em voo no máximo e retomada sem rajada.
- [ ] C2. Simular HTTP 500, timeout de 8s e backoff de 30s; medir volume real no gateway isolado.
- [ ] C3. Simular transporte que ignora AbortSignal; verificar quarentena sem consulta simultânea.
- [ ] C4. Simular transporte que **nunca** termina; documentar indisponibilidade de comandos e alerta local. **Bloqueador de integração até recuperação operacional validada**.
- [ ] C5. Simular reconexão, relógio 1970 e alternância Wi-Fi; não multiplicar temporizadores.

### D. Cache offline e reprodução
- [ ] D1. Carregar playlist e mídias no cache de bancada; cortar internet e confirmar reprodução contínua.
- [ ] D2. Reiniciar sem internet e com relógio inválido; validar que mídias previamente armazenadas continuam.
- [ ] D3. Restaurar rede; conferir sincronização e ausência de download duplicado.
- [ ] D4. Confirmar que alterações de polling não mudam heartbeat, manifest, acesso, mídia nem histórico de reprodução.

### E. Reinicialização, token e estado
- [ ] E1. Reiniciar Player durante consulta em andamento; descartar resposta da geração anterior.
- [ ] E2. Trocar token no ambiente isolado durante screenshot; impedir ACK no dispositivo/conta errados.
- [ ] E3. Executar resetPairing e reconectar; confirmar limpeza de timers, sem requisição órfã afetando nova sessão.
- [ ] E4. Reiniciar repetidamente (3 ciclos) e conferir um único agendador ativo por ciclo.

### F. Requisições e desempenho
- [ ] F1. Comparar 30–60 min em 5s versus 15s ocioso no mesmo ambiente isolado; contar **somente** chamadas `commands`.
- [ ] F2. Medir separadamente heartbeat, manifest, acesso, mídia e ACK; não confundir redução de comandos com redução total do Supabase.
- [ ] F3. Medir p50/p95/p99 de descoberta e conclusão de screenshot, falhas, sobreposições, capturas duplicadas e períodos de quarentena.
- [ ] F4. Repetir com 1 e múltiplos dispositivos **somente de bancada**; validar ausência de rajadas simultâneas.

### G. Rollback
- [ ] G1. Com flag experimental desativada, manter baseline 5s e um único timer.
- [ ] G2. Habilitar 15s somente no ambiente isolado; medir e comparar.
- [ ] G3. Voltar para 5s; confirmar nenhum timer duplicado, ACK perdido, alteração no cache ou mídia interrompida.
- [ ] G4. Simular rollback durante consulta travada; **não iniciar nova consulta concorrente** antes de encerramento comprovado da anterior.
- [ ] G5. Registrar commit/configuração de retorno, critérios de acionamento e responsável pela decisão.

## Critérios mínimos de aprovação
- Nenhuma captura duplicada para comando já confirmado, nenhuma execução em sessão obsoleta, nenhuma consulta simultânea; ACK incerto reconciliado no servidor.
- Cache e reprodução preservados offline e após reboot; zero regressão de sincronização/controle de acesso.
- Recuperação comprovada de consulta permanentemente travada **sem sobreposição** ou decisão explícita de não integrar enquanto isso não for possível.
- Rollback 15s→5s sem duplicar timers ou perder cache.
- Comparação de requisições por categoria, com evidências, e latência de screenshot aceitável definida antes dos testes.
- **GO** exige todos os itens críticos PASS, aprovação humana e autorização específica. Qualquer crítico FAIL/BLOCKED = **NO-GO**.

## Estimativa teórica (não é medição)
Polling ocioso ideal: 5s = 17.280 consultas `commands`/TV/dia; 15s = 5.760 consultas/TV/dia, redução teórica de **66,7% apenas nessa categoria**. A frequência ativa de 5s por até 60s e falhas alteram os números reais.

## Registro de evidências (preencher quando houver execução autorizada)
| ID | Resultado (PASS/FAIL/BLOCKED) | Evidência | Observação |
|---|---|---|---|
| A1–G5 | NOT RUN | — | Planejamento apenas |

**Decisão atual: NO-GO para produção.** Este documento é um checklist, não comprovação de teste em TV Box.
