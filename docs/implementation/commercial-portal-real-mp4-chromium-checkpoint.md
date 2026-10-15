# Vision Mídia Digital — Checkpoint MP4 real e fallback da prévia comercial

**Checkpoint de origem:** `75c462f76b2d1b89b34ee5a265695911b2c64c9d`.  
**Branch isolada:** `fix/advertiser-portal-safety-20261013`.  
**Escopo:** homologação do **portal do anunciante** no Chromium com dados fictícios. Sem player de cliente, APK, Supabase remoto, migrations, Edge Functions ou deploy.

## Testes concluídos e evidências

**Chromium headless real:** 82 verificações PASS, 0 falhas; quatro dimensões CSS **320 / 390 / 768 / 1280 px**, sem erros de JavaScript nem pedidos do navegador fora do loopback.  
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38665619915

**Suíte de segurança geral:** 343/343 testes PASS, 0 falhas; proteção dos arquivos operacionais PASS.  
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38665620008

### Arquivos modificados na branch de laboratório

- `commercial-ui.mjs`: patch mínimo no elemento de prévia. Ao emitir erro de carregamento/decode de imagem ou vídeo, remove **somente o elemento inválido** da prévia e apresenta `Prévia indisponível no momento.`; a campanha, os contadores e as demais mídias do painel permanecem. O handler recusa eventos de erro de um elemento já substituído para não sobrescrever prévia nova.
- `tests/commercial-portal-safe-preview.test.cjs`: dois novos testes isolados para erro de MP4 e callback atrasado que tenta apagar prévia atual.
- `tests/browser/commercial-portal-sanitized-browser.cjs`: geração efêmera de arquivo **MP4 real H.264** com FFmpeg de teste, `yuv420p`, `+faststart`, resolução 320×180 e duração aproximada de 1,5 segundo. O servidor local aceita HTTP 206 e `Content-Range` para reprodução por faixas. Verifica `loadedmetadata` (ou `readyState` equivalente), dimensões, duração, `video.play()`, avanço superior a 1 segundo e evento `ended`.
- O mesmo navegador simula 404 e corpo MP4 corrompido; verifica desaparecimento do vídeo inválido, fallback legível, campanhas e métricas intactas e ausência de requests externos.
- `.github/workflows/commercial-portal-sanitized-chromium.yml`: instala FFmpeg **somente no runner temporário** quando ausente; valida `libx264` e executa o Chromium. Não altera dependências/lockfile nem instala codecs em TV de cliente.
- Este documento de evidência e limitações.

### Resultado técnico

A reprodução real no Chromium passou em todos os checkpoints:

1. A assinatura simulada devolve URL apenas da cópia fictícia `commercial-ads/<uuid>.mp4`, e nenhum caminho da mídia original do estabelecimento.
2. O arquivo gerado é decodificado pelo Chromium: duração positiva e abaixo de 3 segundos, dimensões de 320×180, `readyState>=1` e evento `ended` após a reprodução.
3. Resposta **404** para o mesmo MP4 exibe o aviso sem interromper os dados do anunciante.
4. Resposta de `video/mp4` com bytes inválidos também exibe o aviso e preserva o painel.
5. Controles de login, logout, bloqueio por `403`, falha de assinatura, URLs de outro domínio e responsividade do checkpoint anterior continuam passando.
6. A suíte protegeu o player, API operacional, dados de TV, APK e configurações de deploy.

A primeira tentativa deste bloco parou antes do navegador porque o runner GitHub não tinha FFmpeg instalado. O workflow foi ajustado para instalar o encoder no ambiente descartável, sem fallback para arquivo vazio. A segunda execução confirmou a reprodução e a resiliência.

## Limites e pendências antes de qualquer ativação

- O vídeo rodou em **Chrome/Chromium de desktop Linux**, não na TV Box Smart Pro 3000 nem em Android WebView antigo. Isso não atesta suporte a codec/hardware em TVs reais.
- Autenticação e assinatura Supabase foram **simuladas** com fixtures, e as mídias são sintéticas. O browser não consultou o banco real.
- O SQL revisável `supabase/sql/advertiser-portal.sql` continua **não corrigido fora da bancada** para o achado de metadados internos. O patch de RLS/colunas segue exclusivamente em `tests/fixtures/commercial-safe-projection-lab.sql`. Não liberar o portal real sem homologação e autorização específica.
- A verificação de decode não comprova reprodução em TVs dos clientes, mensuração de impressões reais, qualidade de exibição comercial nem disponibilidade após ficar offline.
- O teste usa FFmpeg instalado no runner; nada foi persistido na produção, no frontend nem nos dispositivos.

## Próximo bloco seguro

Consolidar um **checklist de compatibilidade de prévia para players WebView antigos**, e exercitar a UI em Chromium com mídia que alterna entre disponível/indisponível ou é substituída durante carregamento, para evitar regressão por `onerror` atrasado. Manter a integração experimental isolada; qualquer teste com TV Box/Android real, staging remoto ou publicação depende de autorização explícita.

**Regra permanente:** nunca tocar no player oficial, APK, playlists, Supabase/Edge Functions de produção, deploy Netlify/Vercel ou mídias de cliente sem autorização específica.
