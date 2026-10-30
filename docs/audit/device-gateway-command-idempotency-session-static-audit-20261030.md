# Auditoria estática — idempotência, sessão e ACK tardio do gateway Vision

Data: 2026-10-30. Escopo: leitura de `supabase/functions/device-gateway/index.ts` e `player.js` na branch `audit/playback-query-performance-20261030`, comparação com `docs/audit/permanently-stuck-command-poll-recovery-options-20261030.md`. **Não foram executados testes nem acessado Supabase.**

## Achados verificáveis

### Autenticação e escopo
- `device-gateway/index.ts:171–189`: `authenticateDevice` usa cabeçalho `x-device-token`, SHA-256 do token, `device_credentials` com `revoked_at`, e busca dispositivo associado. Token revogado é rejeitado em nova requisição. Isso é autenticação por credencial, **não** um protocolo de `generation/epoch` por sessão.
- `device-gateway/index.ts:231–237`: bloqueios de conta/acesso antes das ações.
- `device-gateway/index.ts:297–318`: `commands` consulta `device_commands` com `company_id`, `device_id`, `status in (pending,sent)`, limite 3; muda apenas `pending` para `sent` mediante filtros por empresa/dispositivo/status. **Proteção de gravação repetida de entrega**, não exclusão mútua de polls HTTP.

### Resultado de screenshot e idempotência
- `device-gateway/index.ts:321–332`: `screenshot_result` exige `command_id` existente, da mesma empresa/dispositivo, tipo `screenshot`. Consulta `device_screenshots` por `command_id`; se já existir, retorna `duplicate:true` e marca comando `completed`.
- `device-gateway/index.ts:333–359`: se não existir, valida bytes/cotas, faz upload com `upsert:false` em caminho determinístico `company_id/screenshots/device_id/command_id.jpg`, insere registro e marca comando `completed`. Há defesa contra sobrescrita do mesmo caminho, **mas check-then-upload-then-insert-then-update não é uma transação atômica**. Concorrência e falhas parciais não estão integralmente resolvidas apenas pelo código observado. Não foi verificado o esquema/índice único de `device_screenshots.command_id` nem comportamento de armazenamento real.
- `device-gateway/index.ts:362–367`: `screenshot_error` atualiza somente comando `pending` ou `sent` da empresa/dispositivo autenticados; não regride `completed` por essa via.
- A atualização de `completed` na ramificação `duplicate:true` usa apenas `id`; o `id` veio de consulta filtrada por empresa e dispositivo, mas não há filtro explícito de `status` nessa atualização. No fluxo normal, `completed` já é esperado; uma alteração concorrente de estado não está protegida por compare-and-set nesta linha.
- A consulta de screenshot existente não inclui filtros de empresa/dispositivo na própria consulta, embora o `command_id` tenha sido previamente validado como pertencente à TV. A robustez depende da unicidade/consistência desse identificador.

### Sessões antigas, respostas tardias e cliente
- `player.js:677–710`: guarda os últimos 50 IDs confirmados; `processingCommands` bloqueia repetição **local** enquanto processa. Em resposta perdida de `screenshot_result`, não marca ACK e espera reconciliação indireta via listagem de comandos `pending/sent`. Se o servidor concluiu, o comando deixa de aparecer; se não concluiu, pode haver nova captura.
- `player.js:691–710`: não se observa `generation guard` na execução de captura/ACK; `gateway()` usa estado do token na hora da chamada, exigindo análise específica de troca de sessão durante operação. O código lido **não prova** descarte de ACK obsoleto.
- `player.js:785–792`: polling oficial a 5s com `setInterval`; não há exclusão mútua de polls no trecho, embora haja proteção por `processingCommands` por ID.
- A autenticação de cada requisição impede uso de token **revogado** após revogação efetiva, mas não garante rejeição de requisição que já passou pela autenticação antes da revogação. Não há evidência de `session_epoch`/fencing token para operações já em curso.

## Matriz de resposta
| Pergunta | Conclusão estática | Limite |
|---|---|---|
| Existe `command_id`? | **SIM**: identificação, busca de screenshot e caminho de storage | Não prova transação/idempotência concorrente |
| Existe controle de empresa/TV? | **SIM**: autenticação e filtros | Não equivale a isolamento de sessão antiga |
| Existe proteção contra gravação repetida em `commands`? | **SIM**: só atualiza `pending` | Não impede duas consultas em voo |
| Existe proteção de screenshot repetido? | **PARCIAL**: busca por `command_id`, caminho determinístico e `upsert:false` | Falhas parciais e corrida entre consulta/upload/insert permanecem a validar |
| Existe proteção comprovada contra ACK atrasado de sessão anterior? | **NÃO COMPROVADA** | Token revogado ajuda apenas novas autenticações |
| Existe recuperação de poll que nunca resolve? | **NÃO IDENTIFICADA** neste gateway | Quarentena experimental fica bloqueada até término real |

## Comparação com estudo de recuperação
- **B: quarentena fail-closed** permanece opção mais conservadora no cliente; o gateway não fornece hoje prova suficiente para retries cegos.
- **F: diagnóstico local/intervenção controlada** continua opção operacional provisória de menor consumo; não restaura sozinho o canal.
- **C: recriação isolada de contexto** exige provar descarte seguro de efeitos tardios, especialmente no backend.
- **E: idempotência/fencing servidor** tem elementos aproveitáveis (`command_id`, filtros, caminho fixo), mas **não está demonstrada como garantia completa** de sessão e transação. Não propor migração nem mudança nesta auditoria.
- **A: retry automático após timeout** continua rejeitada devido a risco de consulta/ACK duplicados.

## Verificações documentais futuras antes de qualquer GO
1. Conferir migrações/constraints e políticas referentes a `device_commands` e `device_screenshots` (índice único por `command_id`, integridade referencial, transições de status); distinguir branch auditada de estado efetivo do banco.
2. Verificar todos os pontos de emissão e revogação de credenciais, inclusive comportamento de requisições já autenticadas.
3. Analisar concorrência de `screenshot_result`, falha após upload antes do insert, falha após insert antes de completar comando e risco de limpeza de arquivos antigos.
4. Definir protocolo de sessão/epoch e ACK idempotente **somente como proposta**, sem executar mudanças.
5. Somente em fase futura autorizada, testar com gateway e banco **isolados** e WebView de bancada.

## Decisão
**NO-GO para integração ou publicação.** Há proteções parciais úteis no gateway, mas não há prova estática suficiente de idempotência transacional, fencing de sessão ou recuperação segura de requisição que nunca encerra.

Escopo de entrega: somente documento nesta branch; sem testes, alterações de código, Supabase, produção, TVs, APK ou deploy.
