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
2. **Destinatário escolhido e conferido em leitura:** a conta **Academia Life**, identificada pelo slug `visiontek-group-9c77be`. O proprietário é um administrador ativo da plataforma e tinha **dois dispositivos push ativos** na conferência. A migração preparada cadastra esse destinatário com `enabled=false`, sem envio real; ativação depende de teste controlado e verificação dos acessos do celular.
3. A tabela privada `vision_commercial_alert_recipients` começa com **Academia Life cadastrada, mas opt-in desligado**. Após validação, um operador autorizado pode habilitar somente o par `company_id/user_id` verificado. O Worker filtra push pelo `user_id`; a caixa de Mensagens pertence à conta Academia Life, e outros membros autorizados da conta podem ter acesso ao Inbox. Não vincular nenhuma outra conta.
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

## Ampliação solicitada — aviso ao anunciante e datas visíveis

- **No Master:** a lista de anunciantes traz agora, *dentro do próprio cartão de cada campanha*, data de início, data de vencimento e texto `Faltam X dias` / `Vence hoje` / `Vencida há X dias`. Cálculo de datas civis em `America/Sao_Paulo`, sem abrir diálogos.
- **Ao anunciante:** o Portal do Anunciante mostra um aviso próprio, somente com campanhas pertencentes à sessão autenticada, quando vence no dia ou já venceu. Nenhum controle de publicação é adicionado.
- **Envio externo ao anunciante:** módulo isolado de e-mail via Resend já usado pelo projeto. Usa o e-mail que corresponde **exatamente** ao login verificado do anunciante, apenas se a conta e a campanha não estiverem arquivadas. Uma mensagem por campanha e data de vencimento. Renovação ou arquivamento cancela entregas ainda pendentes da data antiga.
- **Privacidade:** nenhum e-mail de anunciante vai para outra empresa; o Master permanece recebendo somente na conta Academia Life escolhida pelo usuário. Nunca incluir o cadastro do anunciante nas assinaturas push das empresas.
- **Ativação segura:** a tabela `private.vision_commercial_client_alert_config` inicia com `enabled=false`. Antes de habilitar, validar domínio de envio, remetente, chave Resend, texto e envio real para endereço de teste autorizado. Configuração da conta Life também permanece desativada até teste real; nenhum disparo foi feito.
- **Teste de QA:** conferir 0, 1 e vários dias restantes, data no horário local, mensagens apenas ao cliente correto e rejeição de campanha arquivada/rascunho, de e-mail não confirmado e de login divergente.

**Importante:** o aviso por e-mail ao cliente só funcionará após migração, deploy da Edge Function e habilitação controlada. O portal atualmente não tem um canal Web Push próprio para anunciantes; não prometer push ao cliente sem criar e homologar esse fluxo separadamente.

## Push para os anunciantes — canal principal

Pedido adicional: **não depender do e-mail**. Preparado um fluxo de Web Push autenticado para cada anunciante.

- No Portal do Anunciante, após login, o próprio cliente clica **Ativar notificações push** e autoriza as notificações no navegador. O botão **Enviar teste** verifica o push no próprio aparelho; **Desativar neste celular** remove a inscrição do backend. Não existe prompt automático.
- No Android, um navegador compatível pode receber push com o portal fechado. No iPhone/iPad, é necessário adicionar o Portal do Anunciante à Tela de Início como aplicativo e autorizar as notificações; criado `advertiser.webmanifest` específico para isso.
- Inscrições ficam na tabela `public.vision_advertiser_push_subscriptions` com RLS e acesso somente via Edge Function autenticada; a função valida `auth.getUser`, usuário vinculado, anunciante ativo e e-mail de login confirmado. **Não** usa `web_push_subscriptions` dos estabelecimentos e não envia dados comerciais a outros usuários.
- A nova fila `private.vision_commercial_advertiser_push_deliveries` tem unicidade por campanha/anunciante/data de vencimento, cancelamento se a campanha for renovada/arquivada e envio apenas a aparelhos previamente inscritos daquele usuário. Fila e configuração em tabelas privadas; configuração começa **enabled=false**. Sem inscrição, o portal continua exibindo o vencimento sem push.
- O agendador existente `commercial-expiry-alerts` passará a chamar a fila de push separadamente do e-mail; falha do e-mail **não** bloqueia push. O aviso ao Master segue restrito à conta Academia Life.
- Os cliques em notificações abrem a página do Portal do Anunciante no site oficial; a página exige login para mostrar dados. A prévia não concede permissão para publicar mídia ou alterar campanhas.
- Ao sair explicitamente da conta no mesmo aparelho, o portal tenta remover a inscrição do anunciante sem cancelar a inscrição do navegador compartilhada com a Vision Master. Se estiver offline e falhar, apresenta aviso para repetir a desativação após reconectar.
- Não foi enviado nenhum push real. Homologar abertura, permissão, cadastro, teste, renovação de data, revogação, Android e iPhone compatível antes de produção. A Edge Function do cliente usa JWT válido e não libera endpoints anônimos; o worker do agendador usa o token interno já existente.
- O e-mail permanece recurso secundário, opcional e desligado por padrão. Não confundir configuração Resend com comprovação de entrega.

**Para ligar depois da homologação:** fazer backup; revisar migration e permissões; implantar `advertiser-push` (JWT habilitado) e nova versão de `commercial-expiry-alerts` (token interno); garantir VAPID e origem de Service Worker corretos; instalar UI atualizada; testar inscrição de um anunciante real com autorização; ativar `private.vision_commercial_advertiser_push_config.enabled` apenas após validação e monitorar registros.
