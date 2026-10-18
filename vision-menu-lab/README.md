# Vision Menu Digital — MVP 02 (laboratório isolado)

**Não é uma rota do painel ou do Player oficial.** Nenhum backend, Supabase, TV real, API ou CDN é usado. Todos os produtos e preços são dados fictícios.

## Executar localmente

Na raiz deste repositório, execute `python3 -m http.server 8765` e abra `http://localhost:8765/vision-menu-lab/`. É necessário um servidor HTTP local porque os arquivos JavaScript usam módulos ES. Para os testes de lógica: `node --test vision-menu-lab/tests/menu.test.cjs`. A suíte existente (`npm test`) não é alterada.

## Arquitetura

- `menu-template.mjs`: coordenadas fixas no espaço lógico 1920x1080, convertidas proporcionalmente para porcentagens; não usa reconhecimento visual.
- `menu-data.mjs`: regras puras de preço, nome, ordenação, grupos de oito e rascunho local.
- `menu.js`: aplica texto aos oito elementos já criados. Trocar grupo **não toca** no elemento `<video>`, em seu `src` ou na camada visual.
- `menu.css`: estilo vetorial/gradientes de madeira e elementos decorativos inspirados na referência; não contém nomes, preços, logo ou vídeo gravados permanentemente na imagem de fundo.
- `fixtures/demo.webm`: vídeo pequeno de teste gerado sinteticamente e distribuído no laboratório.

O botão Salvar persiste **somente** nome do estabelecimento, itens e intervalo via `localStorage` do navegador. O arquivo de vídeo e a logo enviados permanecem apenas em memória da aba; após recarregar, devem ser selecionados novamente. Não há publicação nem upload.

A logo demonstrativa é texto editável, não é o logotipo original extraído do screenshot. O fundo decorativo é uma aproximação independente, não uma restauração da foto do Canva.

## Isolamento

Todo o conteúdo desta implementação fica dentro de `vision-menu-lab/`. O player oficial, painel, APK, service worker, gateway, banco, playlists e anúncios não foram projetados para importar esses arquivos. A existência da pasta não ativa o Menu Digital.

A próxima fase deverá incluir revisão visual, verificação de permissões/backend/RLS em ambiente de homologação isolado, cache e regras de intercalação. Nada disso faz parte deste protótipo.
