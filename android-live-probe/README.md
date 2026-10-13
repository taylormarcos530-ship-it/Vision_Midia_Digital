# Vision Live — Ensaio

Aplicativo independente `com.visionmidia.liveprobe`, versão `0.1.0-ensaio`.
Não substitui o Vision Player. Não transmite nem grava: conta e descarta buffers
H.264. **Ainda não é vídeo ao vivo no painel.**

Instala em Android 7+, mas o ensaio exige Android 10+ (limite de frames do encoder)
e notificações habilitadas (ação Parar). Nenhum pareamento ou token é copiado.

1. Use somente um aparelho de ensaio. Abra o app e toque Iniciar ensaio.
2. Habilite notificações e aceite a confirmação Android em até 30 segundos.
3. Selecione tela inteira e abra o Vision Player manualmente.
4. Volte ao app para ver codec, dimensões, frames, bytes e tempo.
5. Encerre pela notificação, botão Parar ou Android. Limite de três minutos.

Cada sessão exige consentimento novo. Rotação/região alterada encerra a captura.
Sem áudio, rede ou gravação. Conteúdo protegido pode não ser capturável; contadores
não comprovam qualidade visual. O APK debug não é atualização de produção.

Compilar: JDK 17 completo, Gradle 8.9, SDK 35, build-tools 35.0.0.

```sh
sh test.sh
gradle --no-daemon assembleDebug lintDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`. Conferir com apksigner e aapt.
Testes físicos ainda pendentes: recusa/expiração, orientação, parada por Android e
notificação, falha do encoder, sessões repetidas. Comparar 30 minutos de reprodução
sem ensaio com 30 minutos contendo sessões de até três minutos, medindo fluidez,
watchdog, memória e temperatura. Não instalar automaticamente em TV comercial.
