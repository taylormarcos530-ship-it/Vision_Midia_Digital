# Vision Mídia Digital — correção da seleção das 6 mídias do laboratório

**Motivo:** no piloto visual, selecionar um único vídeo do estabelecimento causava a reprodução do mesmo arquivo em todas as 6 posições `base`. Isso confundia o teste do anúncio no item 4.

**Alteração exclusiva do laboratório** `commercial-tv-media-player.html` e `commercial-tv-media-ui.mjs`:
- Selecionar até 6 imagens ou vídeos diferentes do estabelecimento; permite seleção simultânea ou adição individual pelo Android.
- Cada arquivo ocupa apenas uma posição do estabelecimento; posições ainda sem arquivo exibem a mídia fictícia de referência, sem repetir o vídeo selecionado.
- Lista com ordem dos arquivos, contador e botão **Limpar mídias do estabelecimento**, incluindo revogação das URLs `blob:`.
- Um arquivo comercial continua separado e aparece apenas no quarto e oitavo item. Reproduções pausadas, reconexão, reinício e isolamento de rede permanecem.
- Nenhum upload, gateway, Supabase, APK, TV real, clientes ou playlists envolvidos.

**Aceitação:** executar testes de UI e regressão total, testar MP4 real com Chromium e gerar somente Preview. O resultado não equivale a exibição comprovada no TV Box físico.
