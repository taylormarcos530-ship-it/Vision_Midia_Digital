# Vision Mídia Digital — checkpoint de revogação entre partes de vídeo (HTTP Range)

**Checkpoint de origem:** `cc3639f4aba88ca56daae5fd4c70c23473a36b10`  
**Branch isolada:** `fix/advertiser-portal-safety-20261013`  
**Ambiente:** Chromium real e servidor HTTP ligado somente em `127.0.0.1`, FFmpeg temporário no runner GitHub Actions, empresas/contas/MP4 sintéticos. **Nenhum Supabase remoto, TV Box de cliente, APK, playlist ou deploy.**

## Objetivo

Comprovar em um navegador real que um endpoint **sintético** de mídia comercial pode revalidar a identidade do anunciante **em cada solicitação HTTP Range** e negar novas transferências após o bloqueio, sem desorganizar a interface existente do anunciante. Um `206` enviado antes de um bloqueio não garante que todos os bytes futuros estarão autorizados. Um `403` posterior também não remove bytes previamente recebidos ou cacheados.

## Evidências

- **Chromium/MP4 Range:** **39 verificações PASS**, sem falhas; arquivo MP4 H.264 genuíno em 320×180 criado pelo FFmpeg somente no runner; servidor descartável e sem requisições externas.
- **Regressão visual anterior:** 113 verificações PASS, incluindo vídeo real e fallback, na mesma execução de CI.
- **Execução Chromium:** https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38669765524
- **Regressão de segurança:** 375/375 testes PASS, 0 falhas; guardião de arquivos operacionais PASS.
- **Execução de segurança:** https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38669765707

## Alterações estritamente isoladas

- **Novo `tests/browser/commercial-video-range-revocation-browser.cjs`**: servidor Node HTTP local com `GET`, `HEAD`, autorização por cabeçalho fictício, escopo por anunciante, `206 Partial Content`, `Content-Range`, `Accept-Ranges: bytes`, `Content-Length`, `416 Range Not Satisfiable` e respostas `Cache-Control: private, no-store`. Cria MP4 por FFmpeg e executa Chromium. Usa a função real `renderCampaigns` do **frontend de laboratório** para verificar a continuidade do painel.
- **Ajuste exclusivo no workflow `.github/workflows/commercial-portal-sanitized-chromium.yml`**: acrescenta o novo script ao gatilho de CI e executa o teste após a bateria Chromium já existente, reaproveitando o FFmpeg e navegador do runner. Mantém o mesmo bloqueio a alterações nos arquivos operacionais.
- Este relatório. Nenhum código do player, do portal em produção, da API comercial, banco de dados ou Storage foi modificado.

## Resultados observados em Chromium

1. **Antes do bloqueio:** a primeira requisição `Range: bytes=0-1023` do anunciante A foi aceita com **206**, 1.024 bytes exatos, header `Content-Range`, `Accept-Ranges: bytes`, `video/mp4` e `Cache-Control: private, no-store`. O primeiro segmento contém o identificador `ftyp` de um MP4 verdadeiro.
2. **Decodificação:** o Chromium identificou resolução **320×180** e concluiu a reprodução do MP4 do laboratório **antes de aplicar a revogação**. Isso verifica arquivo/codificação, mas **não prova interrupção de reprodução já iniciada durante revogação**.
3. **Após bloqueio do anunciante A:** a segunda requisição `Range: bytes=1024-2047` foi negada com **403**, sem `Content-Range` e sem devolver os 1.024 bytes solicitados. Novos `GET` completos e `HEAD` do mesmo usuário também foram negados.
4. **Isolamento:** o anunciante B não foi afetado e continuou recebendo **206** para o próprio arquivo. A tentou obter a mídia de B, B tentou obter a mídia de A e uma conta sem autenticação tentou consultar: todas as solicitações foram recusadas com **403**. Caminho da mídia original do estabelecimento também foi recusado.
5. **Erros de protocolo:** pedido com intervalo impossível foi rejeitado com **416**; respostas de mídia autorizada ou negada são marcadas para não serem armazenadas em cache compartilhado.
6. **Integridade da interface:** campanha, nome do ponto, métricas e container de vídeo do painel ficaram presentes após o bloqueio das novas transferências. Os testes não registraram erros de script ou requisições a hosts externos.
7. **Auditoria sintética:** eventos de aceitação/recusa registram apenas status, identidade de laboratório e intervalo, sem gravar o valor do cabeçalho de autorização ou URLs assinadas.

## Limitações importantes

- O servidor `/commercial-proxy/vision-media` **existe somente dentro do teste** e usa identidades fictícias em memória. **Não foi criada nem publicada qualquer rota operacional**, função Edge ou política Storage. Esta evidência não aprova a ativação comercial real.
- Vídeos podem ter partes já baixadas/bufferizadas. Mesmo que todas as **novas** requisições sejam negadas, o navegador pode terminar de reproduzir bytes já recebidos. Nenhum mecanismo consegue retirar retroativamente cópias ou capturas feitas pelo usuário.
- O navegador enviou o cabeçalho sintético aos pedidos de vídeo por uma interceptação explícita do Playwright; um elemento HTML `video` comum não envia um token bearer arbitrário por conta própria. Uma futura implementação real exigiria um mecanismo de autenticação apropriado para streaming/ranges, revisado para compatibilidade Android/WebView, custo, latência, CORS e segurança.
- O `Cache-Control: private, no-store` emitido pela fixture é uma política proposta do proxy, **não configuração vigente do Supabase/CDN**. Não houve teste em storage real, em TV Box ou sobre CDN.
- O SQL `supabase/sql/advertiser-portal.sql` continua com o achado conhecido de exposição de campos `source_media_id` e `source_storage_path` **se usado sem a fixture de projeção segura**. A correção dessas colunas permanece apenas em laboratório; não ativar o portal antes de resolver esse bloqueio em ambiente isolado autorizado.

## Próxima etapa segura

Produzir matriz de decisão para política comercial de entrega de prévia: **links de curta validade e janela residual aceita** versus **proxy de leitura autenticado a cada GET/Range**. Mapear suporte de vídeo nos navegadores e WebViews alvo, custo e comportamento em falha, sem conectar ao Storage real. Somente com autorização específica posterior avaliar implementação ou ensaio em um staging totalmente separado.

**Regra permanente:** não restaurar baseline antigo; não modificar `player.js`, `android-player/`, playlists, `supabase/functions/device-gateway/index.ts`, dados Supabase ou produção sem autorização expressa. Não publicar migrations, Edge Functions ou deploys.
