# Vision FCM — piloto de teste

- Projeto em branch isolada; não publicar ou atualizar TVs de clientes antes dos testes.
- Registrar no Firebase o aplicativo Android `com.visionmidia.player.homolog`.
- Configurar no GitHub as quatro variáveis `VISION_FCM_APP_ID`, `VISION_FCM_API_KEY`, `VISION_FCM_PROJECT_ID` e `VISION_FCM_SENDER_ID`.
- Configurar o envio FCM HTTP v1 em Supabase com a credencial da conta de serviço mantida fora do repositório.
- Revisar e aplicar a migração `v29_device_fcm_tokens.sql` somente após aprovação e backup.
- O aviso FCM não executa comandos: ele dispara busca autenticada da fila existente.
- Se o FCM não estiver pronto, a TV mantém consultas antigas para comandos.
- Verificar Google Play Services no TV Box, recebimento com tela ligada, comandos pendentes quando desligada, reconexão, cache, rotação e contabilização de anúncios.
- Ao usar FCM, apenas a consulta frequente de comandos é reduzida; heartbeat e programação ainda têm sincronização própria.
- O APK compilado sem parâmetros reais do Firebase não é um teste funcional de push.
