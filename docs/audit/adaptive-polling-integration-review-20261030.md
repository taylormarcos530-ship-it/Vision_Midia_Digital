# Revisão técnica — integração isolada de polling adaptativo Vision (2026-10-30)

**Escopo:** revisão de código e plano de homologação, sem integrar o módulo ao player.js, sem deploy, sem Supabase compartilhado, sem TVs e sem APK. Branch: audit/playback-query-performance-20261030. Base de testes: GitHub Actions #67 (81/81).

## Constatações verificadas
- player.js:691-711: pollDeviceCommands() consulta gateway(action:'commands'), processa screenshots, evita duplicação por processingCommands e IDs reconhecidos no localStorage; a função atualmente não retorna quantidade de comandos.
- player.js:784-792: heartbeat 30s, manifest 15s, comandos 5s, acesso 10s e consulta inicial imediata.
- player.js:804-813: resetPairing limpa timers; integração futura precisa também parar o scheduler.
- player.js:868-869: reconexão sincroniza manifest e filas, mas não dispara consulta imediata de comandos; visibilitychange apenas aciona heartbeat.
- tests/fixtures/adaptive-command-poller-proposal.mjs: agendamento sem sobreposição, idle 30s, active 5s por 60s, erro 30s, reconexão imediata. Não importado pelo player.js.
- Cache de mídia e playlist usam caminhos independentes (player.js:384-542); polling de comandos não deve alterar esse subsistema.

## Riscos e decisões antes de qualquer integração
1. **Latência:** 30s em idle implica espera de até ~30s antes de iniciar screenshot/comando, mais rede e captura. Os testes de latência são determinísticos, não medidas reais. Para SLA mais baixo, testar idle 10s/15s e quantificar custo.
2. **Contagem de atividade:** pollDeviceCommands() não retorna commandsFound; adaptar de modo explícito sem reexecutar comandos ou disparar chamadas extras. Contar apenas comandos acionáveis/novos para evitar manter active indefinidamente por itens já reconhecidos.
3. **Screenshot:** preservar fluxo de screenshot_result, screenshot_error, processamento em curso, ACK persistido e idempotência do servidor; nunca marcar como falha um resultado de rede incerto.
4. **Reconexão:** integrar networkChanged() aos eventos online/offline; no evento online, consulta imediata única, sem duplicar chamadas com timers existentes.
5. **Reinicialização/despareamento:** start/stop idempotentes; parar scheduler em resetPairing; inicializar após token e estado prontos. Evitar timers fantasmas e chamadas concorrentes durante startPlayer repetido.
6. **Offline:** zero consultas de comandos offline; reprodução de playlist e cache devem continuar sem dependência do scheduler nem do relógio local.
7. **Falhas e timeout:** fetch de gateway não define timeout próprio em functionRequest(); uma promessa pendente pode bloquear indefinidamente o scheduler serial. Antes de ativar, definir timeout e estratégia segura de recuperação sem duplicar screenshots em andamento.
8. **Comandos gerais:** o código atual processa screenshot e ignora outros tipos; não prometer cobertura de reiniciar TV sem auditar o caminho de execução no APK/painel.
9. **Volume:** economia estimada de 82,6% aplica-se somente ao polling de comandos na simulação idle 30s/active 5s; não a todas as chamadas Supabase. Heartbeat, manifest, acesso e filas seguem separados.

## Plano de homologação — sem deploy
A. Criar adapter isolado com interface poll() que retorne commandsFound sem modificar lógica de captura/ACK. Primeiro, apenas testes estáticos e mocks.
B. Cobrir command pending/sent, screenshot bem-sucedido, resposta perdida, retries, timeout, falha de gateway, reconnect online/offline, troca de token, resetPairing, startPlayer duplicado, visibilidade, relógio 1970 e cache offline.
C. Simular intervalos 10s/15s/30s, limites de latência e volume para 1, 5 e 20 TVs; documentar trade-off e limite de SLA antes de escolher.
D. Exigir GitHub Actions verde, revisão do diff, rollback de uma linha/feature flag desabilitada por padrão e autorização expressa para qualquer teste em TV de bancada.
E. Somente após aprovação explícita: avaliar integração controlada em branch separada; não publicar automaticamente.

**Estado:** revisão documental; nenhuma integração, deploy ou modificação de produção autorizada ou realizada.
