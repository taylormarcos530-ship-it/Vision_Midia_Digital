# Vision — aviso de vencimento comercial (proposta isolada)

**Estado:** somente código em branch, não implantado. Base: `release/vision-player-1524-stable-bundle-candidate-20261028`.

## Comportamento previsto
- Até as 09h05 (horário de São Paulo) do **dia de vencimento**: a campanha segue válida durante esse dia conforme a programação já existente. Às 09h05, o Master recebe **"Campanha comercial vencida / vence hoje"** como alerta administrativo do prazo comercial; a reprodução não é alterada por este módulo.
- Enviar **uma mensagem por campanha e por data final**, para o administrador explicitamente configurado, com nome do anunciante, nome da mídia/campanha e data `DD/MM/AAAA`.
- Salvar a mensagem na caixa `company_notifications` e tentar Web Push mesmo com o painel fechado. A caixa exibe até 30 mensagens recentes; marcar como lida ou excluir segue individual.
- Em caso de ativação após o vencimento, recuperar **uma vez** as campanhas ainda ativas/pausadas com vencimento nos últimos 7 dias. Ignorar rascunhos, arquivadas e anunciantes arquivados.
- Renovação que altera `end_date`: novo vencimento gera outra notificação quando chegar a data. Entregas antigas ainda pendentes são canceladas. Não altera campanha, mídia, playlists, TV Box nem Player.

**Observação semântica:** este é um alerta *comercial* no dia em que o contrato termina, não uma alteração da regra atual de exibição. Se o contrato deve ser considerado vencido só a partir de 00h do dia seguinte, alinhar o texto do alerta para "vence hoje" antes do rollout.

## Segurança e dependências para ativação
1. Fazer backup do banco e da versão publicada; validar em homologação antes de qualquer deploy.
2. Identificar precisamente o **usuário administrador da Vision** e a conta do painel em que ele deve receber as mensagens. O banco consultado tem múltiplas contas com push e **nenhuma linha visível em `platform_admins`**. Portanto, **não escolher automaticamente uma conta nem inserir destinatários na produção**.
3. A tabela privada `vision_commercial_alert_recipients` começa com **zero destinatários e opt-in desligado**. Após validação, um operador autorizado pode cadastrar o par `company_id/user_id` e habilitar somente o destino correto. O Worker filtra os push pelo `user_id`; o Inbox pertence à conta configurada e pode ser visível a outros membros dessa conta, portanto usar uma conta administrativa dedicada.
4. A Edge Function `commercial-expiry-alerts` deve ser implantada com `verify_jwt=false` **somente** porque faz verificação obrigatória do token interno existente via RPC `verify_subscription_alert_token`. Nunca expor token/role key no front-end.
5. Aplicar a migração SQL apenas depois de verificar requisitos e revisar os efeitos. O `cron.timezone` do projeto consultado é **GMT**: o agendamento `05 12 * * *` executa às 09h05 em São Paulo enquanto o fuso é UTC−3. Confirmar novamente antes da implantação.
6. A rotina é idempotente: tabela privada com unicidade `(campaign_id, recipient_company_id, end_date)`, persistência do Inbox somente no primeiro enfileiramento e até três tentativas de push em caso de falha.
7. Revisar RLS/grants de tabelas `private` existentes antes do rollout. Nenhum ajuste foi aplicado às estruturas anteriores.

## Testes de aceitação
- Cliente com campanha vencendo hoje: 1 notificação + 1 Inbox, somente no destinatário autorizado.
- Rodar o job repetidas vezes: nenhum aviso duplicado.
- Renovação antes de disparar: cancela o push pendente da data antiga.
- Campanha arquivada/rascunho: nenhum aviso.
- Push desabilitado/celular offline: notificação permanece no Inbox, sem bloquear reprodução.
- Múltiplos anunciantes no dia: todos visíveis no Inbox.
- Teste com usuários de estabelecimentos diferentes: **não** entregar informação comercial em contas de parceiros.
- Conferir métricas Supabase e logs de cron sem aumentar tráfego dos players.
- Não fazer deploy do Worker nem aplicar migração antes dos testes de integração em homologação.

## Rollback seguro
Desabilitar primeiro os destinatários; depois suspender o job `vision-commercial-expiry-alerts` com `cron.unschedule`. Não apagar mídias, campanhas, histórico de exibição, playlists ou mensagens entregues. Restaurar só os arquivos modificados no painel/Edge Function se algum teste falhar.
