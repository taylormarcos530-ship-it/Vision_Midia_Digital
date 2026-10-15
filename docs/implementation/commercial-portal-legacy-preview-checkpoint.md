# Checkpoint — carregamento de mídia comercial e compatibilidade DOM

**Checkpoint anterior:** 2f8cf4d5a6d9c3b60fc2da84b03490b851eb6ff7
**Branch:** fix/advertiser-portal-safety-20261013
**Escopo:** portal experimental e testes locais, sem deploy ou mudanças no player/TV.

## Alterações desta etapa

- commercial-ui.mjs: IDs de revisão validados antes de montar o seletor; nenhuma dependência de CSS.escape para localizar prévias.
- Substituição de conteúdo via replaceChildren quando existente ou removeChild/appendChild quando ausente.
- Versão por elemento de prévia, usando WeakMap: respostas de assinaturas e erros atrasados não substituem mídia mais recente; slots que saíram do DOM não são reativados.
- Prévia de vídeo sem suporte indicado em canPlayType mostra indisponibilidade, sem bloquear campanhas e métricas.
- advertiser-portal.mjs: encerramento de sessão limpa cards usando innerHTML, sem depender de replaceChildren.
- tests/commercial-preview-races-compat.test.cjs: 10 cenários offline de concorrência, sessão DOM e caminhos de mídia inválidos.
- tests/browser/commercial-portal-sanitized-browser.cjs: testes visuais de navegadores com APIs DOM simuladamente indisponíveis, respostas fora de ordem e vídeos fictícios.

## Evidência

- Suíte geral: **353/353 PASS, 0 falhas**, guardião dos arquivos operacionais aprovado: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38666600316
- Chromium real: **90 verificações PASS**, 320/390/768/1280 px, MP4 H.264 de laboratório, URL assinada simulada, falhas 404/corrupção e nenhum pedido externo: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38666600351
- Capturas disponíveis por sete dias: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38666600351/artifacts/11940799529

## Limitações

Testes de DOM omitindo CSS.escape ou replaceChildren em Chromium recente **não equivalem a um teste em Android WebView antigo real**. Compatibilidade com módulos ESM, async/await, codecs e drivers antigos ainda não foi homologada em TV Box. Nenhuma API remota, APK ou player operacional foi usado.

O SQL comercial revisável permanece sem correção fora das fixtures de laboratório para metadados de origem do estabelecimento. Não ativar portal nem anúncios comerciais até revisão de permissões, autenticação e autorização, com ambiente isolado aprovado.

## Próxima etapa segura

Verificar proteção de sessões durante refresh/logout quando houver requisição de prévia pendente, somente em fixtures; avaliar depois emulação Android real sem usar equipamentos de clientes.

**Regra:** preservar player oficial, playlists, gateway, Supabase, Edge Functions e deploy de produção. Nenhuma migration ou publicação foi realizada.
