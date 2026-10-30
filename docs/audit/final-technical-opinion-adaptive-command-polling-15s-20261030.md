# PARECER TÉCNICO FINAL — polling experimental de comandos a 15 segundos

**Vision Mídia Digital | 30/10/2026 | Somente documentação**

Branch de auditoria: `audit/playback-query-performance-20261030`.

## 1. Decisão executiva
**NO-GO para integração, merge, deploy, atualização de APK ou TVs de produção.** A proposta de 15 segundos é promissora para reduzir consultas ociosas de comandos, mas sua segurança e disponibilidade ponta a ponta ainda não foram comprovadas. **GO apenas para planejamento documental e preparação de futura homologação isolada, mediante autorização específica.**

## 2. Evidências verificadas e limites
- GitHub Actions [execução 41107305101](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41107305101), commit `8fe6d7894575cd4f125ca9e70ef308efac6ebbc1`: **117 testes PASS, 0 FAIL, 0 SKIP**, em simulações isoladas e PostgreSQL local isolado, conforme auditoria anterior.
- Casos adicionais incluem rollback com consulta pendente, mudança de token entre captura e ACK, resposta perdida de screenshot e contagem simulada.
- Simulação de 60s: 12 consultas no intervalo de 5s contra 5 no intervalo de 15s, contando a consulta inicial; redução observada nessa janela simulada: 58,3%. Em regime contínuo ocioso, a taxa teórica passa de 12 para 4 consultas/minuto: **66,7% de redução na categoria de consultas de comandos**, não no total de chamadas ao Supabase.
- `player.js` oficial segue intervalo de **5s**. Os 15s estão somente em propostas/fixtures de auditoria. Outros fluxos (manifest, heartbeat, acesso, mídia/ACK) não são substituídos por esta proposta.
- **Nenhum teste em TV Box real, WebView, gateway real ou Supabase compartilhado é alegado neste parecer.**

## 3. Riscos residuais e classificação
| Risco | Severidade | Evidência atual | Condição de resolução |
|---|---|---|---|
| Promise de transporte ignora `AbortController` e nunca encerra | **Crítica** | Quarentena fail-closed impede consulta concorrente, mas pode bloquear canal indefinidamente | Recuperação operacional comprovada sem sobreposição e sem efeitos tardios |
| Screenshot ACK HTTP perdido e repetição | **Alta** | Cliente não marca ACK incerto como sucesso; gateway verifica `command_id` | Idempotência ponta a ponta e reconciliação no backend isolado |
| Sessão/token antigo conclui após troca | **Alta** | Autenticação por token, mas nenhum fencing de sessão comprovado | Rejeição de operações obsoletas e proteção de ACK em ensaio isolado |
| Corrida entre upload/insert/completed | **Alta** | Passos separados no gateway | Evidência de constraints e atomicidade ou recuperação segura |
| Boot offline, relógio 1970, Wi-Fi intermitente, WebView antigo | **Alta** | Testes simulados apenas | Ensaios reais em TV Box de bancada |
| Rollback com poll pendente | **Alta** | Simulação aprovada | Ensaio de um único scheduler sem consultas órfãs |
| Maior latência de comandos em idle | **Média** | Descoberta pode aguardar até próximo poll de 15s, sem contar latência de rede | SLA definido e p95/p99 aceitos em bancada |
| Economia total de backend | **Média** | 66,7% é estimativa apenas para command polling idle | Medir consultas por categoria, sem extrapolar |

## 4. Idempotência existente no gateway — parcial
Leitura estática de `supabase/functions/device-gateway/index.ts`:
- Linhas 171–189: autenticação por token, verificação de revogação e dispositivo.
- Linhas 297–318: busca de `device_commands` por empresa/TV, status `pending/sent`, e atualização apenas de `pending` para `sent`.
- Linhas 321–359: validação de `command_id`, consulta de screenshot existente, caminho de storage determinístico com `upsert:false`, insert e atualização de `completed`. Os passos são separados; não foi comprovada transação atômica para concorrência e falha parcial.
- Linhas 362–367: `screenshot_error` só altera `pending/sent`.
- `player.js:677–710`: bloqueio local de comandos em processamento e memória dos últimos 50 ACKs confirmados; ACK com resposta perdida permanece incerto.
- **Não há prova estática de fencing/epoch de sessão**, nem de encerramento de transporte que ignora cancelamento. Requisição já autenticada pode estar em andamento quando a credencial for revogada.

## 5. Lacunas SQL — não confundir ausência de evidência com ausência de constraint
Foi confirmado o diretório `supabase/migrations`, mas não foi possível listar/ler integralmente as migrações SQL históricas com a interface disponível. A busca de código não localizou os DDLs de `device_commands` e `device_screenshots`. Portanto:
- `UNIQUE(device_screenshots.command_id)`: **não comprovado**.
- FK de screenshot para comando e FKs empresa/TV: **não comprovadas por DDL**.
- `CHECK`/ENUM de `status` e triggers de transição: **não comprovados**.
- Constraints efetivamente aplicadas no banco também **não foram verificadas**, pois acessar Supabase estava proibido.
Esses resultados **não demonstram inexistência** das restrições.

## 6. Alternativas de recuperação de poll travado
| Alternativa | Segurança contra duplicação | Requisições | Rollback | Parecer |
|---|---|---|---|---|
| Retry automático ao timeout | Fraca se transporte anterior continuar | Pode aumentar | Simples, inseguro | **Rejeitar** |
| Quarentena fail-closed até término real | Forte contra polls locais concorrentes; não contra efeitos remotos | Mínimas durante falha | Exige respeitar poll pendente | **Preferir como proteção provisória** |
| Diagnóstico local e intervenção controlada | Sem retries automáticos | Mínimas | Controlável | **Complementar** |
| Recriação segura de contexto isolado | Depende de invalidar sessão anterior | Controlável | Mais complexo | **Pesquisar, não implementar agora** |
| Fencing/epoch e ACK transacional idempotente no servidor | Potencialmente forte | Depende do desenho | Exige compatibilidade | **Investigar documentalmente no futuro** |
| Reinício automático de app/TV Box | Risco a cache, mídia, quiosque e repetição | Pode causar rajadas | Arriscado | **Não recomendar** |

A opção de menor risco atual é **quarentena fail-closed + diagnóstico local**, com reconhecimento explícito de que o canal pode permanecer indisponível. Isso **não é suficiente para aprovação de produção**.

## 7. Condições para futura homologação em bancada — nenhuma execução autorizada agora
1. Autorizar separadamente uma TV Box exclusivamente de testes, build experimental distinto e gateway/backend com dados fictícios, **sem conexão ao Supabase compartilhado ou contas de clientes**.
2. Confirmar mecanismo de recuperação de transporte permanentemente travado, sem permitir segundo poll ativo ou efeitos obsoletos.
3. Demonstrar idempotência de `command_id`, ACK perdido, concorrência de upload/insert/completed e rejeição de sessão antiga.
4. Testar WebView/Android, relógio incorreto, boot offline, cache, playlist, início automático, quiosque, rotação e reconexão.
5. Medir p50/p95/p99 da latência de comandos, duplicações, erros, contagem por tipo de requisição, consumo de rede e disponibilidade. Definir SLA e limites antes de ensaios.
6. Demonstrar rollback seguro 15s→5s, sem timers duplicados, sem perda de mídia/cache e sem consulta antiga capaz de produzir efeitos.
7. Registrar evidências por caso e decisão formal GO/NO-GO. Aprovação de bancada **não** autoriza automaticamente produção.

## 8. Critérios objetivos
**NO-GO imediato** se houver qualquer consulta concorrente com anterior ainda efetiva, ACK duplicado com efeitos, sessão antiga aplicada, interrupção de mídia offline, dependência de Supabase compartilhado, recuperação sem limite seguro ou ausência de rollback comprovado.

**GO restrito para bancada futura** somente após eliminar bloqueios críticos no desenho, preparar isolamento completo e obter autorização expressa. **GO para produção não está concedido**; exigiria resultados reais aprovados, revisão adicional e autorização específica.

## 9. Evidências documentais relacionadas
- `docs/audit/adaptive-polling-final-bench-plan-117-tests-20261030.md`
- `docs/audit/permanently-stuck-command-poll-recovery-options-20261030.md`
- `docs/audit/device-gateway-command-idempotency-session-static-audit-20261030.md`
- `docs/audit/device-command-screenshot-sql-constraints-static-review-20261030.md`
- `docs/audit/final-historical-sql-ddl-evidence-gaps-20261030.md`

## 10. Registro de não execução
Esta entrega consiste **exclusivamente na criação deste documento na branch isolada**. Não executar testes, SQL, instalações, publicação, merge, alterações de `player.js`, produção, Supabase compartilhado, TVs ou APK.

**VEREDITO FINAL: 117/117 testes simulados aprovados; riscos críticos e lacunas documentais ainda abertos; NO-GO para integração e produção.**
