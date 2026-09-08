# Vision Player Android / TV Box

Aplicativo nativo de empacotamento do Vision Player para Android e TV Box.

## Fluxo

1. Instalar o APK.
2. No primeiro uso, informar o código de instalação da empresa (8 caracteres).
3. O app abre o Player embutido em origem HTTPS local segura (`appassets.androidplatform.net`).
4. O Player busca a identidade visual daquela empresa e mostra o código de vinculação de 6 dígitos.
5. Após vincular, mídias e programação são sincronizadas e mantidas no cache do WebView para reprodução offline.

O código da empresa fica salvo no dispositivo e pode ser alterado pelo botão Voltar/Menu do controle remoto.

## Build

O workflow `build-android-player.yml` copia os arquivos atuais do Player web para `app/src/main/assets` antes de compilar. Assim o APK usa exatamente a mesma versão de `player.html`, `player.js`, `player.css`, `config.js` e demais assets da branch.

A versão de preview gera um APK de debug para homologação. Antes de comercializar, criar chave de assinatura release, configurar versionamento e testar no TV Box físico.
