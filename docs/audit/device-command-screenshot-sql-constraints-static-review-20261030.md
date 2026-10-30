# Auditoria estática das constraints — device_commands e device_screenshots

Data: 2026-10-30. Branch: `audit/playback-query-performance-20261030`. **Somente leitura do GitHub e documentação. Sem execução SQL, testes ou Supabase.**

## Escopo e fontes
- `supabase/functions/device-gateway/index.ts` na branch de auditoria, trechos 297–367.
- `player.js`, trechos 677–710 e 785–792.
- `docs/audit/device-gateway-command-idempotency-session-static-audit-20261030.md`.
- Busca de código do GitHub por `device_commands`, `device_screenshots`, `CREATE TABLE public.device_commands`, `REFERENCES device_commands`, `device_screenshots_command_id_key`, `device_commands_status_check`, `command_id unique`. A pasta `supabase/migrations` foi confirmada como diretório, mas a interface de leitura disponível não forneceu listagem de arquivos SQL nem suas definições. **Portanto, não foi possível inspecionar integralmente o histórico de migrações.** A busca de código cobre a branch padrão; arquivos SQL não indexados ou presentes apenas na branch de auditoria podem não aparecer.

## Matriz de evidências
| Pergunta | Evidência confirmada | Conclusão |
|---|---|---|
| `device_commands.id` é chave primária? | Gateway consulta e atualiza por `id`; nenhuma definição DDL encontrada | **NÃO COMPROVADO por migração** |
| `device_screenshots.command_id` tem `UNIQUE`? | Gateway consulta `maybeSingle()` e usa caminho de storage determinístico com `upsert:false`; DDL/índice não localizado | **NÃO COMPROVADO** |
| `device_screenshots.command_id` referencia `device_commands.id`? | Relação lógica usada no gateway; FK não localizada | **NÃO COMPROVADO** |
| Empresa e dispositivo são protegidos por FK composta? | Filtros de `company_id` e `device_id` no gateway; DDL não localizado | **NÃO COMPROVADO** |
| Existe CHECK/ENUM para `device_commands.status`? | Código usa `pending`, `sent`, `completed`, `failed`; DDL não localizado | **NÃO COMPROVADO** |
| Existem triggers de transição de status? | Nenhuma definição correspondente identificada na busca | **NÃO COMPROVADO** |
| Há proteção no código contra gravação repetida de `sent`? | `index.ts:308–316`: UPDATE condicionado a `status='pending'` | **CONFIRMADO no gateway** |
| Há deduplicação no código de screenshot? | `index.ts:321–332`: consulta existente por `command_id`; `index.ts:348–354`: upload `upsert:false`, insert e completed | **PARCIAL no gateway; não atômico** |
| `screenshot_error` pode sobrescrever `completed`? | `index.ts:362–367`: atualização restrita a `pending/sent` | **PROTEÇÃO CONFIRMADA nesse caminho** |

## Análise de concorrência e transições
- `commands`: lê `pending/sent` e muda apenas `pending` para `sent`. Duas leituras concorrentes podem observar o mesmo comando; filtro no UPDATE evita regravação desnecessária, mas não prova exclusão mútua de requisições HTTP.
- `screenshot_result`: faz leitura de existência, upload, insert e update em passos separados. Sem confirmar índice único/constraint e tratamento de conflitos, não se pode garantir idempotência transacional. Caminho de storage determinístico e `upsert:false` são defesas parciais; falhas entre etapas podem deixar estados intermediários.
- `screenshot_error`: limita atualização a `pending/sent`; já a ramificação `duplicate:true` marca `completed` por `id` sem comparar status atual. Possíveis corridas entre transições exigem verificação futura, não alteração agora.
- `player.js`: `processingCommands` e histórico de 50 ACKs são proteções locais, não constraints SQL nem garantia contra ACK atrasado de sessão anterior.

## Comparação com auditoria do gateway
A auditoria anterior encontrou `command_id`, autenticação por token, filtros empresa/TV e deduplicação parcial. Esta revisão **não acrescenta prova de UNIQUE, FK, CHECK ou trigger**. Logo, as lacunas de concorrência, efeitos tardios e recuperação de poll permanentemente travado continuam abertas.

## Lacunas documentais e próxima investigação segura
1. Obter **lista de nomes dos arquivos SQL** de `supabase/migrations` por uma interface de listagem GitHub somente leitura e ler os candidatos na branch de auditoria, incluindo arquivos de inicialização.
2. Examinar `CREATE TABLE`, `ALTER TABLE`, `CREATE UNIQUE INDEX`, `FOREIGN KEY`, `CHECK`, `CREATE TRIGGER` e alterações históricas dessas duas tabelas.
3. Distinguir **definição no repositório** de **constraint efetivamente aplicada no banco**; a segunda não pode ser comprovada sem consulta ao ambiente, que está expressamente proibida.
4. Se DDL não estiver versionado ou acessível, encerrar com lacuna documental; **não inferir ausência da constraint**.

## Decisão
**NO-GO para integração e produção.** Proteções parciais do gateway confirmadas; unicidade, integridade referencial e transições de status **não comprovadas por DDL** com as fontes disponíveis.

Esta entrega modifica apenas o presente documento na branch isolada. Nenhum SQL foi executado; nenhum teste, código de aplicação, Supabase, produção, TV, APK ou deploy foi alterado.
