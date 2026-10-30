# Auditoria final de integração — polling experimental Vision 15s

Data: 2026-10-30. Branch audit/playback-query-performance-20261030. Revisão documental e leitura de código; **não** é aprovação de deploy. Referência CI: run 41105789080, 107 testes aprovados, zero falhas.

## Escopo e decisão
**NO-GO para integração em produção neste momento.** O conjunto experimental é isolado e passou testes unitários/determinísticos, mas não demonstra comportamento ponta a ponta em WebView/TV Box, gateway real ou rede real. Não modificar player.js, Supabase compartilhado, TVs, APK ou deploy.

## Evidências verificadas
- player.js:691-711: pollDeviceCommands() não retorna `{commandsFound}`; a proposta adaptativa espera esse retorno. Há proteção por `processingCommands` e `SCREENSHOT_ACK_KEY` (últimos 50 IDs), mas a confirmação de screenshot ocorre apenas após resposta de `screenshot_result`. Resposta perdida exige reconciliação com estado do servidor; não presumir erro nem sucesso.
- player.js:784-792: polling de comandos atual é 5s, consulta imediata no início; heartbeat 30s, manifest 15s, acesso 10s são fluxos distintos.
- player.js:804-813: resetPairing limpa timers existentes e `processingCommands`; integrar scheduler requer stop e limpeza explícitos. Cuidado com requisição antiga que resolve depois da troca de token.
- player.js:440-485: manifest, cache local e fallback offline operam independentemente do polling de comandos; não alterar esses caminhos.
- tests/fixtures/adaptive-command-poller-proposal.mjs: uma consulta em voo, 15s experimental via parâmetro idleMs, 5s ativo por 60s, backoff de erro 30s. Depende de sinalização online/offline e resultado `commandsFound`.
- tests/fixtures/quarantined-command-poll-proposal.mjs: AbortController aos 8s; não libera nova consulta antes do término real. Uma Promise que nunca termina mantém o canal bloqueado indefinidamente. `abort()` isolado não prova término da rede.
- Testes automatizados: 107/107 PASS na execução 41105789080, incluindo quatro testes de quarentena. São simulações, não provas de disponibilidade operacional contínua.

## Matriz de riscos
| Risco | Impacto | Bloqueador | Condição de aceite |
|---|---|---|---|
| Resposta perdida de screenshot_result e retransmissão | Captura repetida ou comando pendente | Sim | Teste ponta a ponta com ACK persistente, idempotência por command_id e reconciliação do estado servidor |
| Poll de comandos nunca resolve, mesmo após abort | Canal de comandos fica inoperante | Sim | Definir recuperação operacional comprovada sem sobrepor consultas; observar/alertar e preservar controle de reinício seguro |
| Comando 'sent' reaparece e conta como novo | Janela ativa de 5s fica permanente | Sim | Adaptador conta somente comandos novos/acionáveis; teste de repetição |
| Restart, troca de token ou resetPairing durante requisição | Resultado de sessão antiga aplicado após reinício | Sim | Cancelamento, generation guard e rejeição de resposta obsoleta; teste de reinicialização no meio da captura |
| Boot offline ou relógio 1970 | Perda de mídia/playlist ou intervalos incorretos | Sim | Teste WebView offline, cache preservado, temporização monotônica |
| Redução de frequência de comandos | Captura mais lenta (até ~15s para descoberta) | Decisão de produto | Confirmar SLA de screenshot e comandos com testes reais de bancada |
| Rollback mal implementado | Duplicação de timers ou perda de comandos | Sim | Feature flag desativada por padrão; somente um mecanismo ativo; reversão para 5s validada e sem alterar cache |

## Plano de integração futura — condicionado a autorização
1. Desenvolver **adaptador apenas em branch separada de homologação**, mantendo screenshot, ACK e acesso intactos. Não contar comandos reconhecidos como atividade nova.
2. Tratar o ciclo completo de consulta+captura+ACK; timeout de consulta **não** pode interromper captura/ACK já em curso nem classificar resposta incerta como falha.
3. Definir mecanismo de observabilidade local de quarentena, sem chamadas adicionais contínuas ao Supabase; se a conexão nunca terminar, **não** disparar segunda consulta. Exigir recuperação operacional por reinicialização controlada do contexto de rede, somente após confirmar que a instância anterior não pode mais produzir efeitos.
4. Preservar offline cache e playlist; simular boot sem internet, relógio inválido, rede intermitente, resetPairing e mudança de token.
5. Homologar em dispositivo de bancada explicitamente autorizado, com métricas de latência, duplicações, volume e recuperação; nenhuma TV em produção.
6. Preparar rollback: flag `adaptiveCommandPolling=false` por padrão; alternância mutuamente exclusiva entre scheduler adaptativo e intervalo atual de 5s; rollback sem tocar cache ou banco. Confirmar testes de ida/volta.
7. Somente após resultados e autorização expressa considerar merge, deploy ou APK.

## Limites da economia estimada
15s idle: 5.760 consultas de comandos/TV/dia versus 17.280 a 5s (66,7% menos nessa categoria, em simulação sem atividade). Não é redução global de requisições Supabase; outros timers continuam independentes.

**Veredito:** auditoria documental concluída; testes anteriores aprovados; integração **bloqueada** até resolver riscos de disponibilidade, idempotência ponta a ponta, sessões obsoletas e rollback. Nenhuma mudança no Player oficial.
