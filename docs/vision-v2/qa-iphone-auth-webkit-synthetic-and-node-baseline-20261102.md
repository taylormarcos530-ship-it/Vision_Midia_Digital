# Vision V2 — homologação iPhone WebKit autenticada e comparação Node

Data: 02/11/2026. Branch única: experiment/vision-v2-sequence-watermark-qa-20261031. Commit inicial preservado: c3568f928447a027fb714e21d0d7ed1c0c325ccc. Código experimental auditado: 526861229b71cae6dedf8b3cbfb0be49ebef47e9.

**Produção NO-GO. Segurança TOCTOU FAIL permanece aberta. QA_STREAM_GUARD_GROUP=1, drain desativado. Sem deploy ou acesso a Supabase oficial, Vercel, sites, painéis, APKs, TVs, main ou históricos reais.**

## Evidência de CI e histórico completo

- [Run 41519969272 — WebKit autenticado + Node regression](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41519969272): WebKit **46 PASS, 0 FAIL, 6 NOT_TESTED** (iPhone SE e iPhone 13, Ubuntu 24.04, Playwright WebKit 1.56.1). Zero tentativas de rede externa. Workflow global **FAIL** devido aos 24 FAIL do npm test, não devido ao WebKit. Preservados logs, JSON de cada caso e screenshots.
- [Run 41520319627 — comparação Node imutável](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41520319627): dois jobs isolados, checkout do original c3568f928447a027fb714e21d0d7ed1c0c325ccc e da correção 3cba8f3a0ce8533dc5e9786490aa250b5492a630. **Ambos 331 testes: 307 PASS, 24 FAIL**. Extraídos os 24 títulos de FAIL dos logs, listas idênticas sem falhas adicionais ou removidas; são FAIL preexistentes nesta comparação, NÃO resolvidos.
- [Run 41518105685](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41518105685): 1 PASS, 5 FAIL, 26 NOT_TESTED; convite PWA de instalação interceptava clique no login do iPhone SE/13. QA passou a fechar convite pelo botão de fechar normal, sem remover componente do produto.
- [Run 41518333870](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41518333870): 22 PASS, 24 FAIL, 6 NOT_TESTED; roteiro Playwright confundiu isVisible com elemento dentro do viewport, embora sidebar estivesse fora da tela. Corrigido somente em teste, abrindo menu hambúrguer antes do clique.
- [Run 41518979469](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41518979469): 42 PASS, 4 FAIL, 6 NOT_TESTED. Stub de REST descartava indevidamente o prefixo rpc/ da rota de relatório; corrigido apenas no backend sintético; permaneceram dois FAIL de conexão offline.
- [Run 41519475958](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41519475958): 44 PASS, 2 FAIL, 6 NOT_TESTED; defeito na interpretação de eventos offline pelo código do painel.
- [Run prévio 41515949698, WebKit sem login](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41515949698): 39 PASS, 0 FAIL, 8 NOT_TESTED, três perfis de iPhone, 24 aberturas de tela e oito screenshots; preservado.

## Backend 100% sintético e funções exercitadas

O servidor de testes escuta exclusivamente em 127.0.0.1:8876. Intercepta configurações da aplicação e responde aos contratos de Auth, REST, Edge Functions e armazenamento com objetos em memória. Usa credenciais e empresa sintéticas example.invalid, uma TV fictícia, uma mídia fictícia, uma playlist fictícia, relatório de três reproduções inventadas e mensagem inventada. Não consulta serviços oficiais, e o browser aborta tentativas fora de localhost: no run final **external attempts = 0**.

As 46 verificações efetivamente executadas em WebKit testaram login do cliente e Master com tokens QA, dashboard, TVs, biblioteca, playlist e busca, relatório RPC e contagens sintéticas, caixa de mensagens e marcar como lida por mock, input de seleção de PNG sem enviar para nuvem, logout e remoção da sessão local, validação e navegação Master (clientes, planos, auditoria e dashboard), pesquisa de cliente, composição de notificação sintética com resposta no_subscriptions (nenhuma notificação real enviada), interface offline/online de ambos os painéis, além do registro verificável de requisições locais. Preservaram screenshots dos perfis iPhone SE e iPhone 13.

**Não confundir seleção de arquivo e mudança de texto de conexão com upload cloud ou recuperação real de mídia offline.**

## Bug de conexão identificado e corrigido SOMENTE na branch experimental

A função updateConnectionStatus(force) no app.js interpretava o objeto Event passado por addEventListener('offline', updateConnectionStatus) como valor verdadeiro. A expressão original era:

    const online = force ?? navigator.onLine;

Quando recebia o Event, ela indicava Conectado mesmo durante offline. Alteração mínima no commit **3cba8f3a0ce8533dc5e9786490aa250b5492a630**:

    const online = typeof force === 'boolean' ? force : navigator.onLine;

No WebKit QA, a interface offline foi exercitada com context.setOffline(true) mais override sintético de navigator.onLine false e envio do evento offline; para reconexão, true e evento online. Isso comprova apenas a transição visual sob simulação controlada, não a recuperação de dados de serviços remotos. Nenhum deploy realizado.

## Suíte Node ampla: 24 FAIL preexistentes permanecem

O npm test do run final contou 331 testes: **307 PASS / 24 FAIL**. A comparação executou os mesmos testes no checkout original e no commit com ajuste offline. **Exatamente os mesmos 24 títulos FAIL**, envolvendo contratos de Master/comercial, mídia, PWA, FCM, relatórios de playback/telemetria, playlists e cache offline. Sem novos FAIL nessa comparação, mas também sem correção desses 24. Os testes incluem checagens históricas estáticas e de comportamento; investigar um por um antes de concluir que cada um representa uma regressão real de produção.

## Seis grupos ainda não comprovados

1. iPhone físico, Safari real, instalação do PWA na Tela de Início, permissão de push e entrega Apple.
2. Supabase/Auth/RLS reais, sessão expirada e restauração de autorização em backend homologado.
3. APK Android/TV Box, vídeo, áudio, autoplay, rotação física, reprodução e 100/300 TVs em operação real.
4. Recuperação de conexão e cache de mídia offline reais; sincronização entre navegador, player e servidor.
5. Upload efetivo de arquivos em storage, cobrança/PIX, email, WhatsApp e envio de notificações reais.
6. Acesso aos dados/comerciais reais, relatórios de reprodução oficiais, faturamento e custos reais do Supabase Free.

## Vereditos finais

| Critério | Resultado |
|---|---|
| WebKit autenticado com backend sintético | **PASS 46/46 casos executados** |
| Funções sem hardware/backend real | **NOT_TESTED 6 grupos** |
| Isolamento localhost e bloqueio de URLs externas | **PASS, 0 tentativas externas** |
| Correção visual online/offline experimental | **PASS no WebKit QA** |
| npm test da base e da correção | **FAIL 24/331 em ambos, conjunto de FAIL idêntico** |
| Protocolo V2 multiprocessos e corrida TOCTOU | **FAIL segurança, NO-GO** |
| iPhone físico, serviços reais, publicação | **NÃO TESTADOS, NÃO ALTERADOS** |

**Não liberar produção. Preservar todos os artefatos, screenshots e runs anteriores. Não habilitar drain nem alterar Supabase, APKs ou TVs.**
