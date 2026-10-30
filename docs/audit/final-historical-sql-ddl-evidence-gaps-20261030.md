# Relatório definitivo de lacunas documentais — DDL de comandos e capturas

Data: 2026-10-30. Auditoria exclusivamente estática do GitHub, branch `audit/playback-query-performance-20261030`. Nenhum SQL ou teste executado; nenhum acesso ao Supabase.

## Procedimento e alcance
1. Busca no código GitHub por `device_commands`, `device_screenshots`, `CREATE TABLE public.device_commands`, `REFERENCES device_commands`, `device_screenshots_command_id_key`, `device_commands_status_check`, `command_id unique`, e variantes de nomes SQL.
2. Leitura direta de `supabase/functions/device-gateway/index.ts` e `player.js` na branch isolada; revisão dos documentos de auditoria anteriores.
3. Confirmada a existência do diretório `supabase/migrations`; a operação disponível para ler arquivos recusou o caminho por ser um diretório, e a busca de código não retornou os DDLs pretendidos. A busca GitHub indexa a branch padrão; portanto, resultados vazios não demonstram ausência de migrações no repositório ou em commits históricos.
4. Não foi obtida uma listagem recursiva completa nem percorrido todo o histórico de commits. **Esta limitação impede conclusão categórica sobre ausência de constraints** e deve acompanhar qualquer reutilização deste relatório.

## Matriz conclusiva de evidências
| Questão | Estado documental | Justificativa |
|---|---|---|
| SQL histórico que criou `device_commands` | **Não localizado** | Nenhuma definição DDL correspondente recuperada |
| SQL histórico que criou `device_screenshots` | **Não localizado** | Nenhuma definição DDL correspondente recuperada |
| `UNIQUE(device_screenshots.command_id)` | **Não comprovado** | Deduplicação em aplicação não substitui prova de índice |
| FK `device_screenshots.command_id -> device_commands.id` | **Não comprovado** | Vínculo lógico em código, sem DDL |
| FKs de empresa e dispositivo | **Não comprovadas por DDL** | Filtros no gateway são proteções de aplicação |
| `CHECK`/ENUM do status | **Não comprovado** | Valores observados `pending`, `sent`, `completed`, `failed` |
| Triggers para transições válidas | **Não comprovadas** | Não foi localizada definição SQL |
| Bloqueio de efeitos de ACK tardio por geração de sessão | **Não comprovado** | Token autentica dispositivo; não há fencing/epoch demonstrado |

## Proteções de código efetivamente verificadas
- `device-gateway/index.ts:297–318`: consulta por empresa/TV e atualização de `pending` para `sent` somente quando ainda pendente.
- `device-gateway/index.ts:321–359`: screenshot por `command_id`, consulta de registro existente, caminho determinístico e upload `upsert:false`; operações de leitura, upload, insert e atualização não são demonstradas como transação única.
- `device-gateway/index.ts:362–367`: `screenshot_error` atualiza apenas status `pending/sent`.
- `player.js:677–710`: proteção local por ID em processamento e até 50 ACKs confirmados; não prova segurança transacional do servidor.

## Comparação com recuperação de poll travado
A falta de prova de `UNIQUE`, FK, CHECK, triggers e fencing de sessão impede concluir que retry de uma requisição abandonada seja seguro. Continua apropriada apenas como orientação conservadora a quarentena fail-closed, sem novos polls concorrentes, com diagnóstico local; isso não resolve disponibilidade se o transporte nunca encerrar. Não confundir evidência ausente com constraint inexistente.

## Veredito final desta investigação
**LACUNA DOCUMENTAL NÃO RESOLVIDA. NO-GO para homologação de integração/produção.** Não propor nem aplicar mudanças de produção. Este relatório encerra a investigação com as evidências acessíveis e as limitações explicitadas.

Escopo de alteração: exclusivamente este documento na branch de auditoria. Sem testes, SQL, backend, `player.js`, TVs, APK, deploy ou merge.
