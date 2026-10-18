# Vision Menu Digital — Marco de publicação simulada (laboratório isolado)

Base remota conferida: `feature/vision-menu-digital-mvp-isolated` em `0f357f0c2bd5f52cc2ea57305470c9d4d2a785ad`; referência `fix/advertiser-portal-safety-20261013` em `f81324089265c6ee46a623c3a9523b789a96256b`.

## Entrega desta rodada — fase de homologação pré-integração

Adicionados **somente arquivos novos** dentro de `vision-menu-lab/`:

- `publish-contract.mjs`: contrato puramente em memória para rascunho, versão, pré-verificação, publicação simulada, desativação, auditoria e isolamento por empresa/TV.
- `fixtures/publish-lab.mjs`: duas empresas e quatro TVs fictícias, inclusive TV de outra empresa, TV com playlist e TV com anúncios.
- `publish-lab.html`, `publish-lab.css`, `publish-lab.js`: interface responsiva de três passos. Lê o rascunho local salvo no editor já existente, seleciona TV fictícia, testa bloqueios e simula publicação. Sem login, chamadas externas, banco, Supabase ou TVs reais.
- `tests/publish-contract.test.cjs`: verificações de estados, autorização fictícia, mídia vinculada, revisão otimista, isolamento, preservação de anúncios e playlists.
- `tests/publish-browser-check.py`: Chromium isolado com scripts embutidos em memória, sem servidor HTTP.

## Evidências verificadas

- `node --test vision-menu-lab/tests/*.test.cjs`: **41/41 PASS** (inclui 21 testes prévios, todos reexecutados, e 20 novos).
- `python vision-menu-lab/tests/publish-browser-check.py`: **14/14 PASS**, renderização e clique real em Chromium sem rede, incluindo celular.
- Tentativa HTTP em Chromium local: **bloqueada por `net::ERR_BLOCKED_BY_ADMINISTRATOR`**. Não declarar o cenário HTTP homologado.
- A versão publicada em simulação não é afetada por edição de rascunho. Publicação exige confirmação, versões esperadas e TV sem programação/campanhas.
- Publicação fictícia é descartada ao recarregar a página. Esta página **não exibe preço em TV real** nem fornece controle de campanhas/playlist.

## Linha de chegada objetiva

**Concluído:** protótipo visual e de vídeo; regras dos produtos; fluxo local de rascunho, seleção da TV fictícia, pré-verificação, publicação e desativação simuladas.

**Próximo único bloco técnico:** integrar, mediante autorização específica, a entrada `Menu Digital` no painel de **homologação**, persistência de dados por tenant e snapshot por TV (com RLS backend), reutilização segura da biblioteca e leitura de menu pelo player de homologação atrás de flag OFF. Homologar intercalamento sem afetar campanhas e playlists. Nenhuma migration/Edge/deploy em produção por este checkpoint.

**Último bloco após o anterior:** homologação ponta a ponta com TV fictícia/TV física de teste autorizada, regressão geral, reconexão/cache/offline e confirmação de vídeo persistente; só então pedir autorização separada para ativação controlada na produção.

Não abrir novos MVPs por conveniência; não reauditar o laboratório sem regressão comprovada. SQL-01/SQL-02 seguem bloqueados. Nenhum arquivo oficial foi modificado.
