# Vision Diagnóstico TESTE — aplicativo Android totalmente separado

APK experimental de diagnóstico, destinado **somente à TV Box de testes**.

- Nome exibido: **Vision Diagnóstico TESTE 0.3**.
- Pacote da v0.3: `com.visionmidia.diagnosticlab.v03`. Diferente da v0.1, v0.2 e do pacote `com.visionmidia.player` do cliente; instala lado a lado, sem assinatura compartilhada ou substituição.
- Android 5.0+ (minSdk 21). Java nativo, sem Chrome, WebView, rede, login ou dependências de terceiros.
- **Permissões Android: nenhuma.** Não acessa banco, Supabase, campanhas, serviço de gateway, TV de cliente ou dados do aparelho.
- Inclui um vídeo MP4 H.264 azul de ~2 segundos; o resultado é exibido explicitamente após o término, como **MP4 CONCLUÍDO** ou **ERRO**. A cor azul por si só não é uma falha. Sem mídia comercial real.
- Uma sequência de textos fictícios permite simular conclusão da mídia, queda e reconexão (3 s) e reinício (2 s), mantendo rodada/posição na memória da tela.
- Horizontal/vertical **somente simulação visual da moldura**; não altera a orientação física da TV nem o quiosque do sistema. Na v0.3, **Tela cheia** amplia de fato o quadro num diálogo nativo e apresenta **SAIR DA TELA CHEIA**; a tecla Voltar também fecha, preservando rodada/item.
- Sem transmissão, logging remoto, analytics, registro de impressão ou auto-início.
- O botão de arquivo de vídeo é opcional e depende de existir um gerenciador de arquivos compatível na TV Box.
- Ao deixar o aplicativo, o teste para. Reiniciar Android de verdade **não** restaura a rodada: esse requisito não está homologado.
- O vídeo embutido pode falhar em aparelhos sem decoder H.264 funcional; a falha é relatada no painel, nunca omitida. Na v0.3, a faixa verde/vermelha do resultado **desaparece automaticamente após 3 segundos**, preservando o texto de diagnóstico abaixo. O timer do resultado é separado do rodízio e não reinicia a rodada.

## Compilação isolada

```sh
cd android-diagnostic-lab
gradle :app:assembleDebug
```

Saída: `app/build/outputs/apk/debug/app-debug.apk`.
Automação GitHub Actions `vision-diagnostic-apk.yml` faz a compilação e disponibiliza artefato separado. Sem deploy de produção.
