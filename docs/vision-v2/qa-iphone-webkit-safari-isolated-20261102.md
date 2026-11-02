# Vision Mídia Digital — auditoria em iPhone por WebKit (homologação isolada)

Data: 02/11/2026. Branch exclusiva: experiment/vision-v2-sequence-watermark-qa-20261031. Produção **NO-GO**, nenhum deploy. O teste não consultou Supabase oficial, contas reais, anúncios, TV, APKs, painel/site oficial, logs ou histórico real; rodou um servidor HTTP local somente em 127.0.0.1:8765.

## Execuções reais, preservando FAILs históricos

- [Execução final 41515949698 — PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41515949698): **47 verificações; 39 PASS, 0 FAIL, 8 NOT_TESTED**; três perfis WebKit iPhone SE, iPhone 13 e iPhone 13 Pro Max, 24 aberturas de tela com 8 páginas distintas; 8 screenshots do iPhone 13, dados sem credenciais; artefato qa-iphone-webkit-results contém QA JSON, consoles, dimensões e imagens. Os 24 carregamentos não provaram integralmente todas as funções das páginas.
- [Execução 41515603968 — PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41515603968): 45 verificações; 37 PASS, 0 FAIL, 8 NOT_TESTED após o conserto do manifesto.
- [Execução 41515209711 — product FAIL intencional](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41515209711): 45 verificações; 36 PASS, **1 FAIL**, 8 NOT_TESTED. O arquivo manifest.webmanifest era referenciado pelo index.html, mas HTTP 404 no repositório. Corrigido **SOMENTE na branch experimental** com manifesto standalone e os ícones reais já versionados: icons/vision-192.png, icons/vision-512.png e icons/vision-maskable-512.png.
- [Execução 41514945638 — infrastructure FAIL](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41514945638): Playwright WebKit 1.56.1 não suporta Ubuntu 26.04 do runner; não executou testes de página.
- [Execução 41515043730 — infrastructure FAIL](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41515043730): o shell padrão do contêiner não aceitou pipefail; mantida verificação de credenciais, corrigido para bash.
- A execução estável usa contêiner oficial mcr.microsoft.com/playwright:v1.56.1-noble, baseado em Ubuntu 24.04. NENHUM iPhone físico, iOS Simulator/Xcode, push nativo ou instalação real foi testado.

## O que foi efetivamente exercitado

1. Perfis WebKit emulados de iPhone SE, iPhone 13 e iPhone 13 Pro Max: viewport, usuário móvel e touch; 24 páginas carregadas (index, master, pontos demonstrativo, anunciante demonstrativo, downloads, player web, conteúdo diário e notícias).
2. Cliente: layout de login, formulários renderizados e navegação/abertura; não foi realizada autenticação verdadeira.
3. Master: presença do formulário, validação HTML nativa de email inválido, sem enviar credenciais a servidores reais.
4. Rede de Pontos: modo ilustrativo ?demo=1, pesquisa com e sem resultados, retorno do ponto, filtros por cidade e categoria, abertura/fechamento de modal, nome do ponto.
5. Portal do Anunciante: modo ilustrativo ?demo=1, dashboard demonstrativo, alternância entre anunciante liberado e suspenso, bloqueio visual do acesso suspenso.
6. Convite PWA no Safari: aparece, apresenta instrução correta Compartilhar > Adicionar à Tela de Início; botão fechar remove aviso. O manifesto e cada ícone foram requisitados localmente e respondem HTTP 200.
7. Revisão automática de scrollWidth e innerWidth: nenhuma rolagem horizontal global além da tolerância de 4 px em 24 combinações.
8. Revisão de pageerror: nenhuma exceção JavaScript não tratada nas 24 aberturas testadas. Isso não garante que todas as chamadas assíncronas ou rotas autorizadas estejam funcionando.
9. Todos os requests de browser foram bloqueados se não partissem de http://127.0.0.1:8765; zero tentativas externas na execução final. Configurações JS reais de Supabase foram substituídas apenas nas respostas do servidor local QA. Nenhum segredo ou usuário real foi utilizado.

## Oito grupos NÃO TESTADOS: sem afirmar sucesso

| Função | Motivo |
|---|---|
| Login real, refresh de sessão, esqueci senha | Sem Supabase de homologação e conta fictícia autorizada |
| Master: TVs, mídias, playlists, planos, vencimentos e notificações | Exigem autenticação/backend real ou mock transacional mais abrangente |
| Web Push em iPhone físico | Permissão e delivery push não são equivalentes em WebKit Linux |
| Adição efetiva do PWA à Tela de Início | Exige Safari/iPhone físico e gesto de usuário |
| Player nativo Android/TV Box | APK não executa no iOS |
| Reprodução de vídeo, som, autoplay, quiosque, rotação física | Exigem dispositivos e mídias reais de homologação; o browser só abriu a tela |
| Pagamento, PIX, WhatsApp externo, uploads reais | Transações e serviços externos foram bloqueados por segurança |
| Câmera, permissões, localização e envio de arquivos | Exigem hardware e permissões de iOS ou ambiente externo testável |

Os testes **não simulam completamente o aparelho**, apenas WebKit em Linux com perfis de iPhone. Uma interface pode passar na abertura e continuar com ações que dependem de backend indisponível. Portanto, a afirmação "todas as funções funcionando no iPhone" NÃO está validada.

## Interpretação e segurança

O manifesto faltante foi uma falha real do repositório, corrigida somente na branch experimental; não afirmar correção já publicada. Os 39 PASS são verificações distintas de comportamento e carregamento local, não 39 módulos comerciais totalmente homologados. O player principal e APK não foram modificados. QA_STREAM_GUARD_GROUP=1 e drain desativado continuam preservados. A auditoria de TOCTOU no protocolo multiprocessos também permanece FAIL/NO-GO em documentação separada. Nenhum preço/custo real foi inferido.

**Veredito: QA parcial WebKit PASS (39/39 verificadas), cobertura total de iPhone NÃO demonstrada; produção NO-GO.**
