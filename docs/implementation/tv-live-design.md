# Ver TV ao vivo — proposta de 10/10/2026

Status: investigação concluída e proposta para revisão. Não há transmissão implementada, APK novo, migration aplicada, Edge Function publicada ou deploy nesta etapa.

## Objetivo e preservação

Mostrar, enquanto o operador assiste, a tela que o Vision Player realmente está exibindo, incluindo vídeo e mudanças de mídia. Manter o botão de captura e a reprodução atual. Falha ou encerramento do monitoramento não deve reiniciar, pausar, desparear ou limpar o Player.

Base de produção confirmada na Vercel em 10/10/2026: commit 921f365b7f1ee5c7da7c96b74b3cdf1462e180c3, deployment dpl_3ZhCfbaqcCoiLxmVpPjDD6WdYPK7, READY. O checkout local contém alterações anteriores de PWA; elas não devem ser incorporadas por engano nesta etapa.

## Evidências do código existente

- app.js: renderTvViewer, refreshTvViewer e requestDeviceScreenshot exibem imagens; o pedido de screenshot aguarda até 25 segundos e consulta o comando a cada 1,8 segundo.
- player.js: captureCurrentFrame desenha a imagem/vídeo atual em canvas, gera JPEG e envia screenshot_result. Não captura a composição completa de widgets/iframes. pollDeviceCommands aceita somente os cinco comandos atuais.
- device-gateway/index.ts: screenshot_result guarda JPEG no Storage e registra device_screenshots; isso não é um transporte de vídeo.
- MainActivity.java: o APK carrega https://appassets.androidplatform.net/assets/player.html. O workflow copia player.js e demais arquivos para assets antes de compilar. Atualizar o site não acrescenta um transmissor ao APK já instalado.
- app/build.gradle: fontes disponíveis indicam versão 1.5.11, minSdk 24, targetSdk 35 e dependência AndroidX WebKit; não foi comprovado que essa é a versão instalada na TV do usuário. Não há biblioteca de transmissão nem MediaProjection nesses fontes.

## Alternativas avaliadas

1. Capturas automáticas: aproveitam o fluxo atual, porém têm latência, comandos e uploads repetidos. Não equivalem a vídeo ao vivo e não serão rotuladas assim.
2. Canvas transmitido por WebRTC: pode mostrar imagens e vídeos renderizáveis, mas não garante a tela completa, widgets externos, fontes protegidas ou a composição física. Não atende à promessa de espelhamento integral.
3. Captura nativa com MediaProjection e WebRTC: proposta para a tela completa. Exige APK experimental, autorização do Android e canal de sessão autenticado. Validar suporte e carga no Smart Pro 3000 antes de integrar ao aplicativo estável.

## Fluxo proposto

- Captura continua sendo a opção inicial do modal. Assistir ao vivo só aparece habilitado para Player compatível e recurso habilitado para teste.
- Ao clicar, servidor valida sessão do painel, vínculo atual com a empresa, permissão operacional e propriedade da TV. Emite sessão curta ligada a empresa, dispositivo e usuário.
- Player compatível recebe a solicitação pelo canal separado de monitoramento. Solicita consentimento nativo de compartilhamento; recusa, ausência de consentimento ou timeout preservam captura e programação.
- Transmissão de vídeo sem áudio na primeira versão; nenhuma entrada remota de teclado/mouse. Começar com teto de 720p, 10 fps e 800 kbit/s como parâmetros de ensaio, sem alegar desempenho comprovado.
- WebRTC transporta mídia; a API troca somente sinalização e credenciais temporárias. Um serviço TURN deve permitir acesso entre redes distintas; não contratar nem configurar serviço pago nesta etapa.
- Fechar o modal, sair da conta, trocar de empresa, ocultar a página ou vencer a sessão encerra o receptor e solicita parada. Player também encerra pelo próprio timeout, mesmo se a solicitação de parada não chegar.
- Primeira versão: um espectador por TV, duração máxima de 3 minutos; confirmação explícita para outra sessão. Não manter compartilhamento permanente aguardando futuros espectadores.
- Ao falhar, manter a última captura identificada com data e motivo. Não exibir selo Ao vivo sem fluxo de vídeo ativo; após interrupção remover imediatamente esse selo.

## Isolamento e autorização

- Nova sessão não reutiliza screenshot como um comando de streaming, nem muda o significado dos comandos existentes.
- Dispositivo usa seu token apenas na API autenticada; token não vai ao navegador do espectador, SDP ou URL pública.
- Se houver tabelas de sessões/sinalização, preparar SQL separado: isolamento por company_id, verificação do dispositivo, expiração, um espectador e limites de tamanho/frequência. Não aplicar migration sem autorização específica.
- Revalidar usuário, empresa e dispositivo na criação, sinalização e renovação; verificar revogação. Nenhuma conexão é liberada por conhecer um UUID ou nome de canal.
- Credenciais TURN temporárias emitidas pelo servidor, sem segredos permanentes no site/APK. Nenhuma gravação da transmissão em Storage.
- Captura nativa requer serviço foreground e callback de parada. Não reutilizar consentimento expirado nem tentar contornar a confirmação do Android.

## Etapas e critério para integração

1. Revisar esta proposta antes de implementação da arquitetura nova.
2. Criar checkout separado da produção confirmada e aplicativo de ensaio com identidade separada; preservar APK atual. Validar captura/encoder/transporte local antes de conectar Supabase.
3. Testar na TV Box de ensaio e receptor Android/iPhone: imagens, vídeos, widgets, portrait/landscape, troca de mídia e recusa do consentimento. Se a TV Box não oferecer captura/encoder compatível, manter recurso indisponível e documentar.
4. Preparar canal de sinalização e SQL com testes locais de isolamento, revogação, expiração, duplicação de sessão e desconexão. Sem publicação/aplicação.
5. Preparar integração do botão sob flag desativada, fallback de captura e desligamento idempotente. Testes verificam que encerramento não chama restart, clear_cache ou controles de reprodução.
6. Medir reprodução sem/ com transmissão por 30 minutos: fluidez, watchdog, memória, temperatura e rede. Confirmar encerramento dos recursos após fechar, queda de rede e reinício do app. Não inventar resultados físicos.
7. Somente após esses resultados e autorização específica para infraestrutura, APK e produção, habilitar uma TV de teste; manter reversão pela desativação da flag.

## Fontes primárias consultadas

- Android MediaProjection: https://developer.android.com/media/grow/media-projection — consentimento para cada sessão, foreground service, gerenciamento de superfície/tamanho e callback onStop.
- WebRTC/TURN: https://webrtc.org/getting-started/turn-server e https://webrtc.org/getting-started/peer-connections — sinalização e necessidade de relay quando conexão direta entre redes não funciona.

## Checkpoint

Investigação somente leitura do código e estado da Vercel; nenhuma mudança funcional. Não foram executados testes físicos de streaming. Próximo bloco: revisar a proposta e preparar o ensaio isolado de captura nativa, sem substituir o Player atual.
