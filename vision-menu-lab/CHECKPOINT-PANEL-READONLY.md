# Vision Menu Digital — pré-integração autenticada somente leitura

**Ponto de partida**: branch `feature/vision-menu-digital-mvp-isolated`, HEAD `d4f86610eea1202ee830f30b19f2749a6391c94d`.

## Finalidade e limites

- Criar uma seção de prévia no painel operacional **apenas quando `window.VISION_MENU_PANEL_ENABLED === true` antes da inicialização do `app.js`**. A flag **não está habilitada** em nenhum arquivo de configuração.
- Aproveitar o `state` já autenticado que o painel carrega, sem novas chamadas REST/Storage, sem credenciais no novo módulo, sem alteração de playlists, mídias, campanhas ou TVs.
- Mostrar somente metadados de TVs e vídeos prontos pertencentes à empresa selecionada. O usuário pode visualizar; **não há botão de publicar**, persistência remota, upload ou reprodução no player oficial.
- Ao deslogar, trocar de empresa, perder permissão ou suspender conta, ocultar a prévia; nenhum dado entre empresas é incorporado a HTML via `innerHTML`.
- UI baseada em DOM seguro e controle de acesso preliminar no frontend; **não confundir com RLS/backend real**.
- Configuração desligada: zero importações ou chamadas adicionais, e nenhuma seção extra montada.

## Verificação executada

- `node --test vision-menu-lab/tests/*.test.cjs` (56/56 PASS no laboratório, incluindo 15 casos novos).
- `python vision-menu-lab/tests/panel-bridge-browser.py` (13/13 PASS com dados fictícios em Chromium).
- `node --check vision-menu-lab/panel-bridge.mjs`.
- Nenhuma integração HTTP real com Supabase; **a regressão total de `npm test` ainda exige checkout integral e CI da branch**.

## Linha de chegada (não abrir nova auditoria infinita)

1. **Entrega concluída nesta etapa:** ponte de leitura autenticada, invisível com flag desligada, validada em mocks.
2. **Entrega pendente autorizável:** criar schema/RLS, persistência de revisões e API de publicação com auditoria em ambiente separado, testes A/B e contrato de prioridades com campanhas. Sem aplicar migrations nem publicar Edge Functions sem autorização distinta.
3. **Entrega pendente:** homologar em TV física autorizada (vídeo persistente, cache offline, reconexão, playlist, campanhas), passar CI completo e obter autorização explícita para produção.

Nenhum deploy, merge, alteração de APK, player, gateway, SW, migrations, Edge Function ou TV real. SQL-01/SQL-02 permanecem bloqueados.
