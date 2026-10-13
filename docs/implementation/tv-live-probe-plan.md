# Ver TV ao vivo: plano do ensaio de captura e encoder

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execução pelo agente principal, sem delegação.

**Goal:** Produzir um APK de ensaio que comprove captura nativa e codificação de vídeo no aparelho, sem substituir nem alterar o Vision Player.

**Architecture:** Aplicativo Android independente, com consentimento MediaProjection, serviço foreground e encoder H.264 alimentado por Surface. Nenhum frame é transmitido, gravado ou enviado ao Supabase nesta fase: o ensaio mede disponibilidade, velocidade, falhas e liberação de recursos. O resultado habilita ou rejeita a próxima etapa de WebRTC; não representa o recurso ao vivo concluído.

**Tech Stack:** Java 17, AGP 8.7.3, compileSdk/targetSdk 35, minSdk 24; somente APIs Android de MediaProjection e MediaCodec. Testes da política de sessão em Java puro, sem instalar dependências no Player.

**Spec:** docs/implementation/tv-live-design.md. Este plano implementa apenas a prova de captura/encoder da etapa 2; autenticação, sinalização, TURN e botão do painel terão planos próprios depois da prova física.

## Global Constraints

- Criar android-live-probe/ separado de android-player/; identidade com.visionmidia.liveprobe, rótulo Vision Live — Ensaio. Não copiar token, pareamento, preferências ou assets do Player.
- Não alterar app.js, player.js, APK atual, workflows, Supabase, produção ou PWA. Nenhuma substituição de baseline.
- Sem áudio, controle remoto, gravação ou permissões INTERNET, microphone e camera neste ensaio.
- Parâmetros de teste: até 1280×720 ou 720×1280, 10 fps, 800000 bit/s; não são garantia de desempenho. Duração máxima por sessão: 180000 ms, com relógio monotônico.
- Consentimento novo por sessão; não persistir nem reutilizar Intent/token de MediaProjection. Usar callback de parada e fechar recursos de forma idempotente.
- Instalação física somente em aparelho de ensaio e por ação explícita do usuário. Não instalar automaticamente na TV comercial.

## Review Focus

1. Consentimento negado/tardio não cria captura nem faz o serviço ficar aberto.
2. Comandos de iniciar duplicados não abrem duas sessões; eventos tardios não reabrem sessão encerrada.
3. Rotação e dimensões ímpares não produzem tamanho inválido no encoder; mudança incompatível encerra com motivo claro.
4. Falha parcial de inicialização libera o que já foi alocado, sem parar outro aplicativo.
5. Expiração ou parada pelo Android fecha encoder, Surface, VirtualDisplay, MediaProjection e tarefa de leitura, mesmo com chamadas de parada duplicadas.

## Task 1: política independente de sessão

**Files:** android-live-probe/app/src/main/java/com/visionmidia/liveprobe/SessionPolicy.java e android-live-probe/tests/SessionPolicyTest.java.

**Interfaces:** SessionPolicy.startRequest(long nowMs) retorna geração ou rejeição; consentResult(long generation, boolean granted, long nowMs) valida geração e prazo; stop(long generation) é idempotente; isExpired(long nowMs) usa relógio monotônico. Estados IDLE, WAITING_CONSENT, CAPTURING, STOPPED; espera de consentimento no máximo 30000 ms e captura no máximo 180000 ms após consentimento.

- [ ] Criar testes Java com assertions para recusa, consentimento após 30000 ms, dois inícios, geração antiga após parada, expiração exata em 180000 ms e dupla parada.
- [ ] Executar javac e java -ea, confirmar falha por classe ausente antes da implementação.
- [ ] Implementar SessionPolicy sem imports Android ou métodos que controlem reprodução.
- [ ] Executar os testes; exigir todas as assertions aprovadas. Commit somente desses arquivos.

## Task 2: APK independente e captura local codificada

**Files:** android-live-probe/settings.gradle, build.gradle, app/build.gradle, app/src/main/AndroidManifest.xml, app/src/main/java/com/visionmidia/liveprobe/ProbeActivity.java, ProbeService.java, CaptureEncoder.java e README.md.

**Interfaces:** CaptureEncoder.start(MediaProjection projection, int width, int height, int densityDpi, Listener listener); stop() idempotente. Listener.onStats(long frameCount, long encodedBytes, long elapsedMs) e onError(String reason). ProbeService consome geração/consentimento transitórios da Activity e valida SessionPolicy antes de iniciar.

- [ ] Verificar JDK 17, Gradle compatível com AGP 8.7.3 e SDK 35 disponíveis; registrar ausência exata se a compilação não puder ocorrer. Não declarar APK compilado sem artefato.
- [ ] Criar projeto novo; manifest declara FOREGROUND_SERVICE e FOREGROUND_SERVICE_MEDIA_PROJECTION, serviço não exportado mediaProjection, e Activity inicial independente. Não acrescentar receiver de autostart.
- [ ] Implementar ProbeActivity com Iniciar ensaio, Parar e estado textual. Lançar createScreenCaptureIntent somente após clique; validar resposta pela geração e pelo relógio.
- [ ] Implementar CaptureEncoder usando MediaCodec video/avc, Surface como entrada, 800000 bit/s, 10 fps, intervalo I-frame de 2 s. Ajustar dimensões pares mantendo proporção e teto; verificar suporte antes de criar display. Não tentar outro codec silenciosamente se o teste falhar.
- [ ] Registrar callback MediaProjection antes de createVirtualDisplay; iniciar serviço foreground após consentimento. Liberar recursos alocados se qualquer etapa falhar. Executar drain do encoder fora da UI; descartar buffers após contar bytes/frames, sem gravação.
- [ ] Implementar notificação de ensaio com ação Parar, timeout local e onStop/onDestroy. Chamar stop() uma vez por recurso mesmo em falha, timeout ou parada duplicada.
- [ ] Compilar assembleDebug; validar manifesto final, pacote exclusivo e ausência de permissão de rede. Inspecionar assinatura e SHA-256 do APK; não publicar workflow ou download de produção.

## Task 3: validação física e decisão de continuidade

**Files:** android-live-probe/README.md e docs/implementation/tv-live-probe-results.md.

**Interfaces:** resultados por aparelho/versão Android, tamanho, codec, frames/tempo, bytes/tempo, motivo de parada e observações da reprodução. Ausência de aparelho é PENDENTE, nunca PASS.

- [ ] Validar recusa de consentimento e disponibilidade de captura na TV Box; reabrir o Player manualmente durante o ensaio. Confirmar que imagens, vídeos e widgets do Player são a região selecionada, e que nenhum conteúdo protegido está sendo prometido capturável.
- [ ] Executar ensaios landscape e portrait, parada por notificação, encerramento pelo Android e falha do encoder. Cada sessão termina em até 3 minutos; observar frames/bytes antes da parada e ausência de atividade depois dela.
- [ ] Comparar reprodução por 30 minutos sem monitoramento com 30 minutos contendo sessões explícitas de ensaio de até 3 minutos, cada qual com novo consentimento. Registrar pausas, watchdog, memória e temperatura; não automatizar consentimento.
- [ ] Rodar novamente testes da política e verificar diff: somente docs/implementation/tv-live* e android-live-probe/ podem mudar. Player, captura, PWA e backend devem ter diff vazio contra a base.
- [ ] Decidir: se captura/encoder/recursos aprovados, preparar plano WebRTC com credenciais temporárias e isolamento por cliente; se incompatível, preservar captura existente e informar limitação. Sem deploy, migration, Edge Function ou instalação comercial.

## Checkpoint de 12/10/2026

Desenho e plano preparados; implementação, compilação e testes físicos ainda pendentes. Próximo bloco após revisão deste plano: executar Task 1 e preparar APK separado da Task 2. O vídeo ao vivo no painel ainda não existe.


## Retomada final de 12/10/2026

Fontes persistidos em `feat/tv-live-probe` antes da compilação final. Tasks 1 e 2
implementadas; build/lint e assinatura verificados. Consultar `tv-live-probe-results.md`
para evidências, decisões e avisos remanescentes. Task 3 exige aparelho físico e
continua pendente; não há integração ao vivo nem mudança em produção.
