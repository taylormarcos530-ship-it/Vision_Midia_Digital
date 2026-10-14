# Vision Diagnóstico TESTE — aplicativo Android totalmente separado

APK experimental de diagnóstico, destinado **somente à TV Box de testes**.

- Nome exibido: **Vision Diagnóstico TESTE 0.4**.
- Pacote da v0.4: `com.visionmidia.diagnosticlab.v04`. Não substitui versões anteriores nem `com.visionmidia.player`; instala lado a lado, sem assinatura compartilhada.
- Android 5.0+ (minSdk 21). Java nativo, sem Chrome, WebView, rede, login ou dependências de terceiros.
- **Permissões Android: nenhuma.** Não acessa banco, Supabase, campanhas, serviço de gateway, TV de cliente ou dados do aparelho.
- Inclui um vídeo MP4 H.264 azul de ~2 segundos; o resultado é exibido explicitamente após o término, como **MP4 CONCLUÍDO** ou **ERRO**. A cor azul por si só não é uma falha. Sem mídia comercial real.
- Uma sequência de textos fictícios permite simular conclusão da mídia, queda e reconexão (3 s) e reinício (2 s), mantendo rodada/posição na memória da tela.
- Horizontal/vertical **somente simulação visual da moldura**; não altera a orientação física da TV nem o quiosque do sistema. Na v0.4, **Tela cheia** amplia de fato o quadro num diálogo nativo e apresenta **SAIR DA TELA CHEIA**; a tecla Voltar também fecha, preservando rodada/item.
- Sem transmissão, logging remoto, analytics, registro de impressão ou auto-início.
- O botão de arquivo de vídeo é opcional e depende de existir um gerenciador de arquivos compatível na TV Box.
- Ao deixar o aplicativo, o teste para. Reiniciar Android de verdade **não** restaura a rodada: esse requisito não está homologado.
- O vídeo embutido pode falhar em aparelhos sem decoder H.264 funcional; a falha é relatada no painel, nunca omitida. Na v0.4, a faixa verde/vermelha do resultado **desaparece automaticamente após 3 segundos**, preservando o texto de diagnóstico abaixo. O timer do resultado é separado do rodízio e não reinicia a rodada.

## Modo novo da v0.4: MP4 real intercalado com imagens fictícias

No diagnóstico, desça até **INTERCALAR MP4 + IMAGENS** para abrir outra Activity offline, totalmente separada do rodízio de textos antigo. Toque em **Iniciar rodízio real**: a sequência possui 6 posições do estabelecimento, cada uma reproduzindo o pequeno vídeo azul MP4/H.264, e duas imagens bitmap locais (EMPRESA A e EMPRESA B), exibidas nas posições 4 e 8.

- **MP4**: avança estritamente pelo callback `VideoView.onCompletion` do decodificador, nunca por relógio fictício.
- **Imagem bitmap**: exibe 2 segundos (tempo simulado), mas é de fato renderizada no aparelho.
- Pausar, simular queda 3 s e reinício 2 s preservam o item na memória da tela. O vídeo pode precisar reiniciar após o prepare; nenhuma persistência após reboot físico.
- Caso o MP4 falhe, **para a sequência**, apresenta o erro e não inventa conclusão ou impressão.
- Sem conexão, arquivos externos, anúncios de clientes, login, SDK extra ou permissões. Os dois bitmap comerciais são gerados nativamente e NÃO representam anunciantes reais.
- `Voltar ao diagnóstico` retorna à v0.3 clássica; os testes anteriores continuam disponíveis.
- **Pendente validação física** na TV Box dedicada: ver vídeo azul terminar por evento real, imagem da Empresa A no item 4, Empresa B no item 8, continuidade na rodada seguinte e comandos de interrupção.

## Compilação isolada

```sh
cd android-diagnostic-lab
gradle :app:assembleDebug
```

Saída: `app/build/outputs/apk/debug/app-debug.apk`.
Automação GitHub Actions `vision-diagnostic-apk.yml` faz a compilação e disponibiliza artefato separado. Sem deploy de produção.
