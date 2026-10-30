# Estudo documental — recuperação de consultas permanentemente travadas (Vision)

Data: 2026-10-30. Escopo exclusivo: branch `audit/playback-query-performance-20261030`. **Sem implementação, execução, deploy ou acesso a produção.**

## Contexto verificado
- GitHub Actions run [41107305101](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41107305101): **117 testes PASS** em ambiente isolado.
- `tests/fixtures/quarantined-command-poll-proposal.mjs`: timeout de 8s aciona `AbortController.abort()`, marca `quarantined=true`, e só libera o canal quando a Promise de transporte efetivamente encerra (`finally`). Se a Promise nunca resolver/rejeitar, a quarentena permanece indefinidamente.
- `player.js` oficial mantém polling a 5s; a solução adaptativa de 15s é experimental, não integrada.
- `AbortSignal` solicita cancelamento, mas não constitui prova de encerramento do transporte nem de ausência de efeitos no servidor. Descartar respostas antigas protege o cliente, mas não desfaz operação que o servidor já realizou.

## Alternativas e comparação
| Estratégia | Duplicação e segurança | Requisições | Android WebView | Rollback | Avaliação |
|---|---|---|---|---|---|
| A. Timeout + retry imediato | Risco de sobreposição e repetição se consulta anterior continuar ativa | Potencial aumento/rajadas | Implementação simples, sem garantia de cancelamento | Simples, porém inseguro | **Rejeitar** |
| B. Quarentena fail-closed até transporte encerrar | Impede segunda consulta local simultânea; não prova idempotência de comandos | Menor durante falha (zero novos polls) | Compatível em princípio; requer ensaio com WebView antigo | Reversão exige respeitar poll pendente | **Base recomendada** |
| C. Quarentena + recuperação por recriação controlada de contexto isolado | Potencialmente alta se contexto anterior for efetivamente encerrado e sessão antiga não puder agir | Baixo, limitado a retomada controlada | Depende de arquitetura Android/WebView; destruir componente não prova por si só término remoto | Moderado, exige estado de geração | **Estudar e homologar** |
| D. Reinício automático do app/TV Box | Pode repetir trabalho e interferir em mídia/quiosque; encerramento de processo local não desfaz efeitos remotos | Boot pode causar pico | Dependente do hardware, auto-start e relógio | Alto risco operacional | **Não preferir** |
| E. Lease/epoch + command_id idempotente e reconciliação servidor | Protege contra efeitos duplicados se validação transacional estiver correta | Consultas adicionais não são necessariamente exigidas; gravações/leituras de estado dependem do desenho | Independente de WebView, mas requer backend e protocolo compatíveis | Complexo, pode exigir migração | **Proteção complementar futura; não autorizar mudança agora** |
| F. Supervisão local com alerta e recuperação manual | Evita retries automáticos; depende de intervenção segura | Mínimo; logs locais sem telemetria contínua | Simples e compatível em princípio | Baixo risco | **Contingência provisória** |

## Recomendação de menor risco
1. **Agora:** manter B (quarentena fail-closed), registrar falha localmente e evitar novos polls enquanto o transporte anterior não tiver encerramento confirmado. Não adicionar retries cegos.
2. **Contingência:** F, sinalização/diagnóstico local e intervenção controlada somente em ambiente de bancada; não reiniciar automaticamente o aplicativo em produção.
3. **Próxima pesquisa:** C + E. Para recuperar disponibilidade sem duplicar efeitos, é preciso provar que o contexto antigo foi invalidado e que o servidor rejeita comandos/ACK de sessão obsoleta ou os trata idempotentemente por `command_id`. Apenas `generation guard` do cliente não garante isso.
4. **Trade-off explícito:** B/F prioriza segurança e consumo, mas aceita indisponibilidade temporária ou indefinida dos comandos; isso é **NO-GO para produção** até definir e homologar recuperação operacional.

## Condições de aceite para futura homologação isolada
- Simular Promise que ignora `abort()` e nunca termina; verificar zero novas consultas concorrentes e alerta local.
- Demonstrar encerramento efetivo do contexto anterior antes da retomada, ou proteção transacional servidor contra efeitos atrasados/duplicados; verificar que cancelar no cliente não é confundido com cancelar no servidor.
- Exercitar token antigo/novo, screenshot_result com resposta perdida, ACK idempotente, comando repetido, rollback durante requisição pendente e restart.
- Medir chamadas `commands` e outras categorias separadamente; sem heartbeat adicional para monitorar falhas.
- Validar cache, boot offline, relógio 1970, mídia contínua e quiosque em TV Box de bancada autorizada.
- Definir limite operacional aceitável de indisponibilidade e mecanismo de intervenção; sem aprovação desses itens, **NO-GO**.

## Decisão
**Escolha atual: B + F (quarentena fail-closed e diagnóstico/intervenção controlada), apenas como orientação documental.** C + E são candidatas para pesquisa e testes futuros, não recomendações para implantação imediata. A é rejeitada. D não é preferida.

**Não executado:** testes, mudanças de código, `player.js`, backend/Supabase, APK, TVs, deploy, merge ou publicação.
