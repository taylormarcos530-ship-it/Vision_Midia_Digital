# Vision Menu Digital — Fechamento visual do laboratório

Branch isolada: `feature/vision-menu-digital-mvp-isolated`. Base original: `f81324089265c6ee46a623c3a9523b789a96256b`.

## O que mudou

- Coordenadas proporcionais calibradas segundo a referência da Casa de Carnes Bom Sabor: logo mais centralizada à esquerda, título mais próximo dos produtos e área de vídeo na direita, acima do rodapé.
- Tipografia do quadro dimensionada pela largura do próprio canvas de TV (`cqw`), e não pela largura da janela do editor, melhorando consistência entre tela cheia, computador e celular.
- Vídeo, preços e logo seguem elementos independentes. Fundo segue ilustrativo/vetorial, sem fotografia licenciada do Canva, sem texto ou valores embutidos na imagem.

## Testes / evidência

- Testes Node da pasta `vision-menu-lab/tests/*.test.cjs` (sem suíte de navegador): 21/21 PASS nesta rodada.
- `browser_check.py` em Chromium isolado via `set_content`: 21/21 PASS, incluindo 5 segundos de alternância automática e confirmação de que o `video` não é substituído nem recebe novo `src` quando preços mudam.
- Teste HTTP nativo anterior continua **pendente por bloqueio do navegador**. A aprovação visual definitiva exige avaliação do responsável.

## Regra de término / Gates

- Gate A (laboratório): funcionalidades + regressão isolada validadas; prévia visual pronta para aceite; HTTP nativo bloqueado, não aprovado.
- Gate B (integração em homologação): pendente, exige autorização separada para alterações em painel, backend, player de homologação, regras comerciais e RLS multiempresa.
- Gate C (piloto físico e produção): pendente, exige uma TV autorizada, cache/reinício/reconexão e regressão real, com liberação explícita. Não transformar o Gate A em vários checkpoints novos.

Nenhuma alteração em player, APK, painel, gateway, SW, playlists, campanhas, banco, migrations, Edge Functions, deploy ou produção. SQL-01/SQL-02 permanecem bloqueados.
