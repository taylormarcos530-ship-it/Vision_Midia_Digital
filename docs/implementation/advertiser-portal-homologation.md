# Vision Mídia Digital — checkpoint de homologação do anunciante (2026-10-13)

**Branch isolada:** `fix/advertiser-portal-safety-20261013`
**Base da feature preservada:** `87d907010db614d5459b6af9c7b421328e64f225`
**Estado atual:** login HTTP real de A e B comprovado por prints; duas campanhas ilustrativas em rascunho no Supabase de homologação; RLS A/B confirmado; TV fictícia simulada inteiramente offline com playlist e anúncios, sem dispositivos, reprodução ou mídias reais. Produção e player intocados.

## Concluído nesta etapa

- Portal do Anunciante: `anunciante.html?demo=1`, já sem credenciais nem consultas remotas.
- Novo Master visual: `master-advertisers.html?demo=1`; uma empresa/campanha e um ponto fictícios, zero reproduções, sem cadastro/edição/senha e sem chamadas Supabase Auth, banco, RPC ou Storage.
- Master sem `?demo=1`: autenticação real continua desabilitada enquanto `commercial-config.js` estiver desligado.
- Salvamento isolado de cópias de mídia comercial e histórico imutável da revisão (etapa anterior).
- CI do GitHub: **99 testes Node/PGlite aprovados, 0 falhas** em https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38484626526 .
- O CI também compara com o commit-base da feature e falha caso sejam alterados APK, `player.js`, HTML/CSS/player, configuração operacional, gateway, rotas operacionais, Master existente ou sites de produção.

## Infraestrutura verificada

A conexão Supabase denominada **Vision mídia digital** retornou um único projeto, `fpadgedrgcxrrqflzhjt`, com status ACTIVE_HEALTHY, que é o banco operacional. **Não há projeto de homologação independente identificado nessa conexão.**

Não se criou projeto remoto: escolha da organização e eventual custo exigem autorização explícita. Não se executou SQL em produção, não se publicou Edge Function, não se alteraram TVs nem dados existentes e não se conectou o preview a esse banco.

## Próximas verificações obrigatórias — somente após disponibilizar homologação independente

1. Criar ou selecionar um **projeto Supabase dedicado e vazio** de homologação, sem dados pessoais, dispositivos reais ou integração com clientes. Obter autorização de organização/custo antes de criá-lo.
2. Instalar schema operacional mínimo compatível no projeto de homologação; aplicar ali `supabase/sql/advertiser-portal.sql`; conferir RLS, políticas Storage, funções e papéis. Nunca apontar `commercial-config.js` ao projeto produtivo.
3. Configurar contas fictícias: Master, anunciante A, anunciante B e estabelecimento de teste. Garantir que A não veja B e vice-versa, e que o estabelecimento não veja dados comerciais.
4. Testar login, sessão expirada, redefinição de senha, revogação do acesso e acesso simultâneo no navegador, com nenhuma chave secreta enviada ao frontend.
5. Testar com *mídias fictícias* no bucket privado: cópia, troca de criação, exclusão da mídia original e preservação da revisão comercial.
6. Testar manifesto/adicionais apenas em **TV fictícia ou dispositivo de bancada**, com flag desativada por padrão e ativação feita só em homologação. Comprovar que sem playlist continua "Aguardando playlist", que mídia original não muda, que o comercial intercala e que falhas preservam a playlist.
7. Simular eventos concluídos/não concluídos, atraso offline, reconexão, expiração, status de heartbeat, histórico, reprocessamento idempotente e desempenho com volume representativo.
8. Verificar limites de armazenamento e custo de snapshots, necessidade de retenção, acesso a miniaturas, políticas preexistentes e impacto do relatório.
9. Somente após esses testes e autorização separada, discutir integração gradual na produção com backup, rollback testado e monitoramento.

## Restrições de segurança

Não alterar `player.js`, APK, playlist operacional, fallback, campanhas existentes, app do cliente ou configurações produtivas sem autorização explícita. Não fazer merge direto para `main`; esta branch parte de uma feature antiga e requer análise cuidadosa de divergência e conflito antes de eventual integração. Nenhuma publicação de funções/SQL no projeto que atende os clientes. Não relatar "testado em TV real" sem prova de laboratório.

**Próximo prompt sugerido:** "Continue da branch fix/advertiser-portal-safety-20261013, confira os 99 testes e avance na homologação isolada sem qualquer alteração no player ou produção."

## Etapa de exclusão segura do anunciante — 13/10/2026

- Incluído **Excluir anunciante** no cartão do Master, com confirmação que explica o bloqueio e a preservação do histórico.
- A exclusão é **lógica/reversível**: `vision_advertisers.archived_at` recebe a data e `status` passa a `disabled`. Não são apagados usuários do Supabase Auth, campanhas, revisões de mídia, arquivos de Storage, reproduções ou registros históricos.
- O cadastro sai da lista padrão. O filtro **Mostrar anunciantes excluídos (recuperáveis)** permite acessar o histórico e **Restaurar anunciante**.
- A restauração retorna a `archived_at=null` com status **desativado**; não permite que campanhas ou login sejam retomados automaticamente. O Master precisa reativar explicitamente depois.
- O portal do anunciante impede novos acessos aos dados via função/RLS enquanto o usuário estiver desativado. A função de manifesto deixa de incluir novas inserções comerciais. **Itens já armazenados no cache do player podem continuar até a atualização normal da programação**; nenhum comando de parada ou alteração do player foi introduzido.
- O preview `master-advertisers.html?demo=1` exibe o botão, porém **não permite exclusão fictícia com escrita**. Todos os botões administrativos seguem desativados no modo demonstração.
- A alteração usa apenas as novas tabelas e o novo módulo comercial na branch. Não foi executado SQL remoto, nenhum dado existente de empresa/cliente foi alterado e nenhuma TV foi atualizada.
- Pipeline atualizado: **103/103 testes aprovados, zero falhas**; inclui arquivamento, recuperação, RLS, manutenção dos dados e gate que protege o APK/player. GitHub Actions: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38486410691

**Próxima etapa:** somente com Supabase de homologação distinto e dispositivos fictícios, testar Auth, exclusão/restauração, propagação do manifesto e reprodução cacheada antes de qualquer ativação operacional.

## Etapa: demonstração interativa de exclusão/restauração (13/10/2026)

- Rota de demonstração: `master-advertisers.html?demo=1`. **Excluir anunciante** pede confirmação, altera somente um objeto local em memória e oculta o cartão da lista padrão; `Mostrar anunciantes excluídos (recuperáveis)` permite visualizar o histórico e usar **Restaurar anunciante**.
- Após restaurar, o anunciante demonstrativo permanece **desativado**; atualizar a página reinicia os exemplos ficcionais. Contagens de exibição permanecem zeradas.
- `commercial-master-demo.mjs` fornece uma sessão isolada sem rede, Auth, banco, localStorage ou sessionStorage. O Master real mantém as chamadas administrativas para a homologação futura, mas sua configuração segue desligada no preview.
- Cadastro, edição, campanhas e senhas continuam desativados no modo demo. Apenas exibição de resultados, Excluir/Restaurar fictícios, busca e filtro são interativos.
- **105/105 testes Node/PGlite aprovados** em https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38486971160 . CI validou novamente que player, APK e rotas operacionais não foram alterados.
- Nenhum SQL remoto, Edge Function, deploy de produção, cliente ou TV sofreu alteração. A interação é uma simulação, não uma exclusão real.

## Etapa: dois anunciantes fictícios e acesso suspenso — 13/10/2026

- Nova simulação independente em `anunciante.html?demo=1`, com seletor de **Loja A**, **Empresa B** e **Acesso suspenso**. Os dois exemplos usam identificadores distintos de anunciante, campanha, versão de mídia e TV; `daily=[]`, ambos offline e sem arquivos de clientes.
- O exemplo suspenso não entrega campanha e esvazia a tela. Alternar os exemplos **não representa autenticação real**, não envolve cadastro, senha nem Supabase.
- O seletor é um componente isolado em `commercial-advertiser-demo-ui.mjs` e utiliza `commercial-advertiser-demo.mjs`. Continua indisponível quando não há `?demo=1`.
- A lógica real de Auth, RLS e os dados de produção não foram alterados. A homologação com credenciais verdadeiras continua bloqueada até haver um Supabase de testes distinto.
- Resultado local de CI: **108/108 testes aprovados**, inclusive a bateria que verifica não haver mudanças no player, APK e APIs operacionais; execução https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38487488565 .
- **Próxima etapa:** obter escolha/autorização da organização para uma instância independente de homologação e testar os logins reais de duas contas fictícias com RLS nesse ambiente, sem publicações em produção.

## Provisionamento Supabase de homologação — confirmado em 13/10/2026

- **Projeto novo e exclusivo:** `Vision Mídia Digital - Homologação`
- **Ref do projeto de teste:** `jmiuitrrhtaeyrpuyohk` — https://supabase.com/dashboard/project/jmiuitrrhtaeyrpuyohk
- **Região de teste:** `sa-east-1` (São Paulo); **status verificado:** `ACTIVE_HEALTHY`.
- **Organização:** `Vision mídia tv`, id `susctwfrittaneqtcywv`, plano Free. O serviço retornou **0/mês** para criar um projeto nesta organização; confirmação do usuário obtida antes da criação.
- **Banco produtivo, proibido para testes:** `fpadgedrgcxrrqflzhjt` — `ACTIVE_HEALTHY`, `us-west-2`.
- A verificação `get_project` para ambas as refs e `list_projects` confirmou dois projetos com **refs e hosts de PostgreSQL independentes**.
- **Infraestrutura apenas:** schema comercial ainda **NÃO instalado remotamente**; nenhuma Edge Function, aplicativo, player, configuração do preview, credencial ou dado de cliente foi copiado/modificado.
- **Bloqueio operacional:** operações de homologação devem apontar explicitamente a `jmiuitrrhtaeyrpuyohk`; nunca executar schema/campanhas no projeto `fpadgedrgcxrrqflzhjt`. Usar contas, mídias, TV e dispositivos fictícios, sem vincular equipamentos reais.
- **Próximo bloco:** validar dependências do SQL num schema mínimo somente em `jmiuitrrhtaeyrpuyohk`; preparar Auth com contas fictícias; comprovar RLS e armazenamento com dados simulados. Nenhum merge/deploy de produção sem autorização separada.

## Homologação Supabase: esquema instalado e testes RLS (outubro de 2026)

**Projeto-alvo único:** `jmiuitrrhtaeyrpuyohk` — **nunca** `fpadgedrgcxrrqflzhjt` (produção).

- Verificação inicial: novo projeto com zero tabelas `public`, sem migrações, Auth e Storage nativos presentes.
- Migradas no **projeto isolado** as dependências operacionais mínimas da bancada: `20261014000855 staging_commercial_baseline_only`; e exclusivamente o schema comercial da branch: `20261014000910 staging_advertiser_transparency_portal_v1`.
- Implantada trava própria de homologação no schema não exposto `private.vision_staging_guard`: migração `staging_strict_environment_guard_only`. A SQL de teste exige esta marca exclusiva antes de gravar dados fictícios.
- Criado somente na homologação o bucket **privado** `vision-media`; sem copiar nenhum arquivo de cliente.
- Verificadas 11 tabelas `public` com RLS ativo, todas inicialmente sem linhas, e sete RPCs comerciais: apenas `public.vision_advertiser_portal()` executável por `authenticated`; as rotas Master/manifesto não podem ser executadas pelo usuário comum ou `anon`.
- Script versionado `tests/sql/staging_advertiser_rls_rollback.sql` foi **executado com êxito diretamente no PostgreSQL de homologação**. Dois registros sintéticos temporários A/B demonstraram isolamento de campanhas e contagens, bloqueio de anunciante desativado e negação anônima. `ROLLBACK` concluído: **zero anunciantes e zero usuários fictícios persistidos**.
- A mesma verificação com a trava exclusiva foi repetida com sucesso. Nada foi executado no banco operacional.
- O Security Advisor de homologação mostrou somente avisos conhecidos: seis tabelas operacionais mínimas sem políticas de acesso (propositalmente inacessíveis por cliente neste ambiente isolado) e a RPC `vision_advertiser_portal` com `SECURITY DEFINER` executável por autenticados, intencional e verificada quanto à identidade. Revisar novamente antes de qualquer integração real. Referência do linter: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable .
- **Não houve criação de contas Auth com senhas reais**, publicação de Edge Functions, conexão de preview a Supabase, teste em TV física, merge ou deploy de produção. O teste de identidades foi transacional, sem login HTTP.
- **Próxima etapa segura:** usar a API Admin Auth no próprio ambiente de homologação para criar duas contas de teste e um Master fictício; testar login real, bloqueio e revogação. Preparar permissões de Edge Function apenas no projeto de testes, sem função nova ou ativação em produção. Depois validar Storage/relatórios com dados fictícios.

## Prévia de login real isolada — 13/10/2026

- Página nova **somente para homologação**: `anunciante-homologacao.html`, na branch `fix/advertiser-portal-safety-20261013`.
- Configuração exclusiva `commercial-staging-config.js`, apontando apenas para `https://jmiuitrrhtaeyrpuyohk.supabase.co` e utilizando a chave **publishable** pública do projeto de testes; sem chave secreta, sem `service_role`. Uma verificação de hostname só libera essa configuração em previews Vercel da equipe `vision-5529` e localhost; demais domínios ficam desabilitados.
- **Portal normal inalterado**: `commercial-config.js` continua `enabled:false`, sem URL ou chave de Supabase. A rota de demonstração `anunciante.html?demo=1` mantém seus dados fictícios e nenhuma API remota.
- Sessões isoladas: token de homologação fica em `sessionStorage` sob `vision_advertiser_session_v1_staging_v1`, separado da chave anterior. Uma resposta de login atrasada após logout/limpeza da sessão não consegue reabrir o acesso.
- Testes com requisições Auth **simuladas em Node**, cobrindo escopo de origem, credenciais inválidas, headers sem segredo, escrita separada da sessão e corrida de logout. **115/115 testes CI PASS**, execução https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38489770482 .
- Consultado o Supabase isolado: `auth.users=0`, `vision_advertisers=0`, `vision_commercial_campaigns=0` e marcador `private.vision_staging_guard` presente. Por isso a interface de login está preparada mas **não houve autenticação HTTP real concluída** e não se devem compartilhar credenciais de produção.
- **Próximo bloco:** criar duas contas fictícias usando a API Admin Auth oficial ou o Dashboard **do projeto de homologação** (nunca inserindo senhas em SQL nem copiando pessoas reais); inserir apenas os vínculos fictícios nas tabelas `vision_advertisers` do novo projeto; testar login real, expiração, RLS de A e B, bloqueio e restauração. Nenhum deploy de Edge Functions nem interação com TVs reais até autorização posterior.

## Vínculo seguro de duas contas Auth confirmadas (homologação)

- **Objetivo:** testar login real de dois anunciantes A e B, sem vincular contas dos clientes nem reproduzir comerciais em TVs reais.
- A integração Supabase ligada ao ChatGPT nesta conta não oferece criação de usuários pelo **Auth Admin oficial**. Não foi usado SQL para definir senhas nem foram alteradas tabelas `auth.users`.
- O script `tests/sql/staging_link_two_auth_advertisers.sql` está **preparado, mas NÃO executado**; exige `private.vision_staging_guard` do projeto de homologação `jmiuitrrhtaeyrpuyohk`, dois e-mails de teste diferentes e previamente confirmados no Auth, e proíbe misturar membros, proprietários ou Masters. Com duas contas válidas, cria exclusivamente os vínculos na tabela `public.vision_advertisers`; não cria Auth users nem modifica senhas.
- **Uso seguro:** no Dashboard de autenticação do novo projeto, criar exatamente dois usuários de teste via `Authentication → Users → Add user` e confirmar o e-mail no fluxo do próprio Auth. As credenciais devem ficar com o operador; não as inserir em commits, tickets ou conversas. Não reutilizar endereço nem senha dos usuários reais.
- Antes de rodar o SQL de vínculo, substituir os marcadores `__TEST_EMAIL_A__` e `__TEST_EMAIL_B__` pelos dois e-mails testados, conferir a ref de homologação e revisar. O script se recusa a prosseguir com marcadores não preenchidos ou identidades não confirmadas.
- Verificação read-only em homologação no checkpoint: `private.vision_staging_guard` presente, **0 Auth users, 0 anunciantes, 0 campanhas e 0 vínculos de TV**.
- **118/118 testes CI aprovados**, incluindo checagens do script, guards, isolamento das credenciais e proteção do player/APK. https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38490355487
- Banco produtivo `fpadgedrgcxrrqflzhjt` intocado; sem deploy Edge, migrations ou mudanças no aplicativo dos clientes nesta etapa.
- **Próxima tarefa:** após as duas contas aparecerem no Auth de homologação, vincular e testar login HTTP real, RLS A/B, acesso suspenso, restauração e sessão expirada sem qualquer ação em TVs reais.

## Vínculo A/B confirmado e isolado (outubro 2026)

- Após consentimento explícito do usuário, dois **usuários Auth existentes, com senhas e e-mails confirmados**, foram vinculados como **Anunciante A** e **Anunciante B** exclusivamente em `jmiuitrrhtaeyrpuyohk`. Os seus e-mails e IDs do Auth **não são reproduzidos nesta documentação nem no script de teste**.
- Os vínculos constam em `public.vision_advertisers` como `active`, `archived_at=null`; ambos foram checados como não administradores e não membros de estabelecimento. Nenhuma senha foi criada, alterada, exportada ou armazenada no GitHub.
- O projeto de produção `fpadgedrgcxrrqflzhjt` não recebeu consultas de mutação, migrações nem funções nesta etapa.
- Script repetível `tests/sql/staging_linked_accounts_rls_rollback.sql`: primeiro valida a trava exclusiva da homologação, descobre os dois UUIDs a partir dos vínculos locais sem expor os dados pessoais, simula os papéis `authenticated`, verifica a separação RLS e bloqueio por arquivamento e executa `ROLLBACK`.
- Teste remoto retornou `PASS: A/B isolated, archive denied and rolled back`, `active_after_rollback=2`, `users_unchanged=2`. As duas contas **permanecem ativas**, campanhas e TVs fictícias continuam não cadastradas.
- **Ainda falta validar login HTTP pelo navegador com a senha conhecida pelo operador**, além de criação e exibição de duas campanhas ilustrativas; a simulação SQL de `auth.uid()` não substitui o teste real do Supabase Auth.
- Preview de testes: `anunciante-homologacao.html` (Vercel preview, nunca domínio de produção). Não usar login/senhas de clientes reais ou da conta Master.
- Próximo bloco: operador entra em cada conta fictícia pelo preview isolado e confirma que os painéis são diferentes; em seguida preparar campanha e impressão fictícias com execução e desmontagem controladas apenas em homologação.

## Duas campanhas ilustrativas em rascunho — checkpoint 14/10/2026

- **Projeto exclusivamente de homologação:** `jmiuitrrhtaeyrpuyohk` (São Paulo). A trava `private.vision_staging_guard` foi verificada antes das operações. Nada foi executado contra a ref operacional `fpadgedrgcxrrqflzhjt`.
- Script versionado `tests/sql/staging_seed_two_draft_campaigns.sql`: cria as campanhas **`HOMOLOGACAO A - Campanha ilustrativa (NAO VEICULAR)`** e **`HOMOLOGACAO B - Campanha ilustrativa (NAO VEICULAR)`**, exclusivamente para os anunciantes de bancada A/B; e-mails e UUIDs pessoais não são incluídos no código.
- As campanhas são `status='draft'`, sem `current_revision_id`, revisões, Storage, playlist, dispositivos, vínculo com TVs ou eventos de playback. Datas são calculadas no fuso de São Paulo e o procedimento valida a ausência de condições capazes de veicular anúncios.
- A mesma SQL de inserção foi executada **duas vezes** com sucesso, resultando em **exatamente duas campanhas**. Não houve duplicação, edição de campanhas existentes nem geração de impressões.
- O teste do portal real via identidade SQL `tests/sql/staging_linked_accounts_rls_rollback.sql` foi atualizado e executado novamente: **PASS** na separação A/B por RLS, cada usuário vê **uma única campanha correspondente, status `draft`**, nenhum ponto e nenhum histórico; a simulação de exclusão bloqueia o acesso e é integralmente revertida por `ROLLBACK`. Ambas as contas permanecem ativas.
- Verificação adicional da situação persistida: `campaigns=2`, `harmless_drafts=2`, `revisions=0`, `tv_links=0`, `recorded_days=0`, `playback_events=0`, `devices=0`, `active_advertisers=2`, manifesto comercial para TV inexistente igual a `[]`.
- CI automático do GitHub: **122/122 testes aprovados, zero falhas**; [execução de verificação](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38492604139). CI também comprovou que arquivos do player, APK e rotas operacionais permanecem iguais à baseline protegida.
- **Login HTTP não foi provado neste checkpoint:** o usuário ainda precisa entrar com senha válida para cada uma das duas contas na página `anunciante-homologacao.html`. O teste SQL simula a identidade autenticada, mas não testa senha ou Auth HTTP.
- **Próximo bloco:** conferir manualmente as duas sessões HTTPS no preview de homologação, confirmar que cada anunciante vê apenas sua campanha fictícia, revisar UX de mensagens e estados de sessão, sem nenhuma integração com TVs de clientes e sem habilitar publicidade comercial em produção.

## Diagnóstico read-only na tela de login de homologação (14/10/2026)

- Nova interface exclusiva `anunciante-homologacao.html` com botão **Verificar conexão e meu acesso**, vinculada a `commercial-staging-diagnostics.mjs`.
- O módulo faz `GET /auth/v1/health` usando **exclusivamente a chave publishable** do projeto de homologação. Esta API pública foi verificada na documentação Supabase; não envia senha, sessão nem dados do cliente nessa consulta.
- Se não houver login, exibe **Supabase de testes acessível / login ainda não efetuado**. Com sessão válida, consulta unicamente `vision_advertiser_portal()` usando o token do próprio anunciante e apresenta nome, número de campanhas, rascunhos, vínculos e exibições daquela conta. Nenhum Master, TV, campanha ou anúncio é criado.
- O diagnóstico rejeita configuração desabilitada, de produção ou sem chave pública; falha caso a API retorne campanha de outro anunciante e ignora qualquer resposta que chegue depois de sair ou trocar de sessão. Usa `textContent`, não `innerHTML` nem armazenamento persistente.
- A página normal `anunciante.html`, o player e a aplicação dos clientes não foram modificados; a configuração do módulo de produção continua inativa. A ferramenta só é carregada no HTML exclusivo da homologação.
- Estado remoto confirmado antes da alteração: **2 anunciantes ativos, 2 campanhas em rascunho, 0 vínculos com TVs, 0 registros diários**, trava do projeto exclusivo presente.
- **128/128 testes aprovados** na CI, incluindo 6 novos testes do diagnóstico, erro de autorização, sessão invalidada e verificação de que não há acesso a recursos de produção. Registro da CI https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38493184820 .
- O teste real de entrada com senha no navegador **ainda depende da confirmação do operador**; não afirmar que foi validado apenas pelos mocks e consultas SQL.

## Confirmação visual do login HTTP do Anunciante A (outubro de 2026)

- O operador enviou duas capturas de tela **da página exclusiva de homologação** no Android. A primeira mostra **Anunciante A - Homologacao** autenticado, diagnóstico `Conexão com o Supabase de homologação: OK`, `Campanhas da conta: 1 (rascunhos: 1)`, `Vínculos com TVs de teste: 0` e `Exibições registradas para esta conta: 0`.
- A segunda captura, após a ação **Sair**, mostra `Você saiu do painel`, a tela de login visível e o diagnóstico `Login: ainda não efetuado neste navegador`. Isso fornece **evidência do fluxo real de login e logout na interface do Anunciante A**; não comprova, por si só, revogação do token no servidor nem o login de B.
- Status honesto da homologação: **A — entrada e saída visualmente confirmadas; B — login HTTP ainda não confirmado pelo operador**. Os testes automáticos e as verificações RLS A/B são evidências separadas e já aprovadas.
- **Não publicar em produção, não habilitar comerciais e não vincular TVs reais.** A campanha A/B continua como rascunho e os dispositivos reais estão fora desta etapa.
- Próximo teste manual: entrar como **Anunciante B** no mesmo preview, verificar `1 campanha em rascunho, 0 TVs, 0 exibições`, confirmar o nome B e realizar Sair, sem fornecer senha no chat.

## Homologação visual concluída: login e consultas dos anunciantes A e B (13/10/2026, horário de Brasília)

- O operador confirmou por **captura de tela de um navegador Android** o acesso HTTPS do **Anunciante B** à página `anunciante-homologacao.html`, com `Conexão com o Supabase de homologação: OK` e `Conta autorizada: Anunciante B - Homologacao`.
- O diagnóstico autenticado exibiu precisamente `Campanhas da conta: 1 (rascunhos: 1)`, `Vínculos com TVs de teste: 0` e `Exibições registradas para esta conta: 0`. O painel também apresentou o título `Anunciante B - Homologacao` e `Atualizado agora.`.
- **Evidência combinada:** operador confirmou **login e consulta real do A** em captura anterior, além de **logout visual do A**; agora confirmou **login e consulta real do B**. A separação A/B em PostgreSQL/RLS e bloqueio por arquivamento já haviam sido validados mediante `ROLLBACK`.
- **Limites:** ainda não existe evidência visual do logout B, nem teste remoto de rotação/expiração de token ou de carga de propaganda em uma TV fictícia. Prints não provam revogação de token do lado servidor. **Nenhuma tela real foi conectada**, nenhuma campanha foi ativada e nenhum deploy de produção foi executado.
- **Próxima etapa proposta:** teste de logout/retorno ao login da conta B, sessões vencidas e estado de erro amigável; depois preparar uma TV de bancada *com dados 100% isolados*, sem modificar o player ou os clientes em produção. Não publicar Edge Functions nem novas migrations de produção sem autorização.

## Sessão expirada, renovação de token e logout B: validação automatizada (14/10/2026)

- Na branch isolada, ajustado `advertiser-portal.mjs` com patch mínimo: caso o Supabase rejeite a renovação do token e `CommercialAPI.refresh()` já tenha limpado a sessão (inclusive erro `invalid_grant` / HTTP 400), o portal agora **oculta campanhas e diagnósticos anteriores, retorna ao login e apresenta mensagem de sessão expirada**.
- Na homologação, o `closeView()` limpa também o resultado do diagnóstico. Em `commercial-staging-diagnostics.mjs`, o resultado anterior é invalidado ao clicar em **Sair** ou ao iniciar outro login; respostas assíncronas antigas não sobrescrevem o estado de uma nova sessão. Nenhuma chamada de escrita, banco, Edge Function, senha ou dado de produção foi adicionada.
- Arquivo de regressão `tests/commercial-session-expiry.test.cjs`: testes simulados de **refresh token recusado**, **refresh token válido com JWT novo**, **falha da API de logout mantendo logout local**, **fechamento do painel após expiração** e **resultado atrasado após logout B**.
- Os testes do diagnóstico também verificam descarte do resultado após logout/troca de conta. A verificação final de CI: **133/133 testes, zero falhas**, https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38495007223 . Os arquivos protegidos de player/APK/APIs operacionais permaneceram iguais à baseline.
- **Não confundir testes automatizados com teste manual:** o operador já comprovou por print os logins A e B e o logout A; o **logout B na interface real** ainda pode ser confirmado com um print, mas a rotina de logout B está coberta por teste automatizado.
- **Estado de produção:** intacto, sem merge, nenhum novo APK, sem campanhas comerciais ativadas, sem TV real vinculada. Nenhum SQL remoto foi executado nesta etapa. O ambiente de homologação segue independente.

## TV fictícia e intercalação de anúncios em simulação offline — 14/10/2026

- Página **`commercial-tv-bench.html`** e módulo `commercial-tv-bench.mjs` criados apenas na branch `fix/advertiser-portal-safety-20261013`. Simulam uma TV fictícia de Auto Center, **sem criar nenhuma linha no Supabase, autenticar, gerar evento ou executar o player**. A página não carrega chave Supabase.
- O simulador importa a implementação comercial real **da branch isolada** (`supabase/functions/_shared/commercial.mjs`) e permite testar 0, 1, 3 ou 6 mídias da playlist, 0, 1, 2 ou 5 anúncios, além de modo aleatório, mídia única, agenda por item e desligamento da camada.
- Corrigido comportamento perigoso na função isolada `interleave()`: anteriormente `items.push(...ads.slice(cursor))` adicionava comerciais excedentes em sequência ao final. Agora insere **no máximo um anúncio por oportunidade entre mídias do ponto**, sem retirar ou reordenar as mídias originais e **sem colocar os excedentes em bloco**. Quando a playlist acaba antes do intervalo completo, uma única inserção pode ocorrer após a última mídia.
- Exemplo com seis mídias + dois anúncios: **Auto 1 → Auto 2 → Auto 3 → anúncio 1 → Auto 4 → Auto 5 → Auto 6 → anúncio 2**. Com seis mídias e cinco anúncios, apenas dois anúncios cabem com este intervalo: os demais ficam fora **do ciclo simulado**, não são marcados como exibidos.
- **Pendência deliberada antes de ativar:** definir rodízio e equidade de múltiplos anunciantes quando há mais anúncios elegíveis que posições por ciclo. A atual lógica limitada não inclui os excedentes, logo **não garante rodízio** em chamadas seguintes. Não liberar campanhas comerciais reais antes de completar e testar essa política.
- TVs sem playlist continuam em **Aguardando playlist**, sem publicidade isolada. `shuffle`, mídia única e agendas da base continuam preservados; a feature flag comercial de produção permanece desabilitada.
- Testes com a integração de `augmentCommercial()` usam Admin RPC/Storage totalmente simulados em Node, sem chamadas reais ou aparelhos conectados. **141/141 testes aprovados, zero falhas**, execução https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38495868400 .
- **Nenhum player.js, APK, device-gateway/index.ts, Supabase de produção, funções operacionais, Netlify ou Vercel production foi alterado/deployado**. O único helper de gateway modificado pertence à camada comercial opcional da branch, ainda não publicada.
- Próxima etapa segura: testar estratégia de rodízio dos anúncios excedentes por ciclos, manter a prioridade da playlist do estabelecimento e validar seu comportamento em bancada; somente depois integrar uma TV de testes cadastrada no Supabase isolado se necessário.

## Rodízio justo simulado entre rodadas — 14/10/2026

- Usuário confirmou em imagens que a TV fictícia manteve a playlist original ao marcar três restrições simultaneamente: `shuffle`, modo mídia única e agenda por item. A proteção de não inserir comerciais nessas condições segue correta.
- Adicionado o botão **Testar intercalação (desmarcar proteções)** no `commercial-tv-bench.html`, somente na página offline. Ele desmarca `shuffle`, `single` e `scheduled` localmente e reativa a flag somente da simulação; **não altera nenhuma opção do estabelecimento real**.
- Criados os controles **Rodada anterior / Próxima rodada** e visualização da lista `Aguardando próximas rodadas`.
- Criada em `supabase/functions/_shared/commercial.mjs` a função **pura** `cycleCommercialSelection(ads,slots,cycle)` e adicionado o **quarto argumento opcional** `cycle=0` de `interleave()`. O comportamento original do gateway quando omite o argumento continua igual (primeira rodada); **nenhuma alteração foi feita em `device-gateway/index.ts` ou no APK**.
- Com seis mídias originais e cinco criativos comerciais, cada rodada oferece **duas oportunidades**. As cinco rodadas são: `A,B` → `C,D` → `E,A` → `B,C` → `D,E`. Cada criativo aparece **duas vezes** após as cinco rodadas, com todas as mídias originais preservadas em ordem e nenhum par de comerciais consecutivos.
- O algoritmo também foi testado para playlist de mídia única, proteção por agenda, `shuffle`, falta de playlist, camada desligada, índices inválidos, pureza de dados, determinismo e segurança do preview sem Supabase.
- O rodízio aqui é **por criativo/mídia comercial**, não mede audiência nem resolve ainda o agrupamento de várias campanhas sob um mesmo anunciante. Na TV real, um player pode repetir o mesmo manifesto em cache; assim, passar para a rodada seguinte **depende de um protocolo explícito futuro de mudança de ciclo** (por exemplo, rotação de manifestos atualizados sem perda de mídia). **Não ativar isso na infraestrutura produtiva enquanto não for validado em player e equipamento de teste isolado**.
- **146/146 testes aprovados, 0 falhas** na CI: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38496727048 ; os arquivos operacionais protegidos permaneceram intocados.
- Nada foi escrito no Supabase, nenhuma playlist/TV real foi conectada e nenhum deploy de produção foi efetuado nesta etapa.

## Validação visual das cinco rodadas da TV fictícia — ciclo completo

- O operador testou a página de bancada `commercial-tv-bench.html` no Android com **6 mídias do estabelecimento e 5 anúncios comerciais disponíveis**, sem playlist aleatória, mídia única nem agendas individuais ativadas.
- Prints enviados pelo operador confirmaram as sequências de anúncios: **rodada 1: Loja do João e Empresa B; rodada 2: Publicidade C e D; rodada 3: Publicidade E e Loja do João; rodada 4: Empresa B e Publicidade C; rodada 5: Publicidade D e E**.
- Na rodada 5, a tela mostrou explicitamente os comerciais D/E nas posições 04/08, a playlist original do Auto Center mantida na ordem (Troca de óleo, Suspensão, Escapamento, Freios, Motor, Revisão) e os demais anunciantes aguardando.
- Portanto, nas **cinco rodadas simuladas, cada criativo foi selecionado exatamente duas vezes**, sem comerciais consecutivos e sem mudar as seis mídias do estabelecimento. Isso demonstra **oportunidades simuladas**, não exibições contabilizadas.
- **Escopo da evidência:** simulação no navegador usando o helper comercial isolado e avanço *manual* pela ação "Próxima rodada"; não representa demonstração do player real, avanço de ciclo automático no gateway, persistência de posição ao reiniciar ou relatório de reprodução concluída.
- Última regressão automática disponível do mesmo código, anterior a este registro apenas documental: **146/146 testes aprovados** no GitHub Actions: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38496805525 .
- Nenhuma campanha real foi ativada, nenhuma TV vinculada, nenhum Supabase operacional consultado ou modificado, nenhum player/APK implantado, nenhuma alteração de produção autorizada.
- **Próxima etapa técnica antes de integração:** projetar e testar em ambiente isolado o avanço seguro de ciclo automático sem reiniciar indevidamente o rodízio a cada atualização do manifesto; prever falhas de conexão/reinício e garantia de não duplicar publicidade, mantendo a programação original do cliente.

## Rodízio automático em bancada isolada com reconexão e checkpoint (14/10/2026)

- Criado módulo **`commercial-tv-auto-state.mjs`**: máquina de estados funcional offline que consome apenas a `simulateBench` e o `interleave` já validados. Um evento explícito de **conclusão simulada do item atual**, acompanhado de um token de geração/rodada/posição/mídia, é a única forma de avançar; callbacks duplicados ou atrasados são ignorados.
- Ao chegar ao fim de **todos os itens da rodada simulada**, o estado muda para `cycle+1`, preparando os próximos anunciantes. Teste automatizado confirmou **5 rodadas completas de 8 itens** com 5 anunciantes e 2 posições por rodada: cada anunciante escolhido duas vezes, nenhuma publicidade consecutiva e playlist base intocada.
- Eventos `disconnect`, `reconnect`, `refresh`, `restart` (checkpoint em memória) e `configure` preservam a posição e/ou invalidam callbacks velhos; `restoreAutoBench` rejeita estados incompletos, índices inválidos, tipos inesperados e posição fora da programação, desativando anúncios nesse caso.
- Página nova **`commercial-tv-auto-bench.html`** + **`commercial-tv-auto-ui.mjs`**, visual e independente da bancada manual. Botões: Iniciar/Pausar avanço automático, Concluir item (simulado), Atualizar programação, Simular queda, Reconectar, Simular reinício e Usar playlist compatível. Controles ajustam exclusivamente a simulação; nenhuma opção de cliente real.
- O relógio de bancada simula o término de uma mídia a cada **1,6 segundo**, somente com a página visível; fechar, atualizar ou trocar de página não preserva a rodada. O timer é cancelado em pausa, desconexão, mudança de configuração ou quando o navegador vai ao fundo. O token impede que callbacks antigos avancem uma programação renovada.
- **Aviso importante:** o "reinício" representado na bancada é um *handoff* de checkpoint mantido na memória da página, **não um reinício real de TV box** e não prova persistência após desligamento, perda da rede, atualização de APK nem funcionalidade real de playback. **A API atual do gateway continua a chamar `interleave(primary,ads)` sem index de ciclo**, portanto **não foi ativado avanço automático no player/cliente de produção**. Esse protocolo requer implementação e validação separadas antes da implantação.
- Alteração mínima na bancada manual `commercial-tv-bench.html`: apenas link de acesso à nova bancada, mantendo todos os controles existentes e as cinco rodadas manuais já aprovadas por prints do usuário.
- CI de homologação **160/160 testes PASS**, 0 falhas; inclui 9 testes novos da máquina de estados e 5 de interação em interface simulada, além das 146 verificações anteriores. GitHub Actions https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38498683224 .
- Proteção automatizada confirmou arquivos originais de player, Android APK, gateway operacional, páginas Master de produção e configuração de deploy **inalterados**; nenhum Supabase (nem mesmo homologação), Edge Function, Netlify/Vercel produção ou TV real foi modificado nesta etapa.
- Próxima etapa: projetar o protocolo de mudança de ciclo e checkpoint persistido **em bancada real exclusiva de testes**. Antes de integrar ao gateway ou APK, validar reconhecimento de término da sequência, idempotência, respeito à playlist, política de rodízio por anunciante e recuperação de reconexão, com aprovação separada para qualquer ativação produtiva.

## Limite de deploy preview Vercel — publicação pendente (14/10/2026)

- O novo laboratório `commercial-tv-auto-bench.html` foi implementado na branch isolada e passou nos testes, mas **ainda não recebeu um preview Vercel confirmado para este commit**.
- Tentativa explícita de deploy Git da branch com `target` preview (sem produção) retornou HTTP **402** com código `api-deployments-free-per-day`: limite de mais de 100 deploys/dia da equipe, orientação da Vercel para tentar novamente após aproximadamente **24 horas**.
- Nenhuma tentativa de contornar a cota por outra conta, projeto novo ou promoção à produção; não foi alterado nenhum serviço operacional.
- Preview mais recente confirmado até o momento pertence ao commit `be2d5d50b3c983c4010bb07acddcdebf81cac526`, anterior à criação da nova página. **Não apresentar essa URL como se tivesse o novo laboratório.**
- Aguardar restabelecimento da cota ou autorização explícita do proprietário para nova tentativa de deploy preview. Código já com testes aprovados no GitHub e checkpoint atual independente do serviço de hospedagem.

## Identidade de programação na recuperação simulada — 14/10/2026

- **Implementado só na bancada offline:** `commercial-tv-auto-state.mjs` agora calcula `autoBenchProgramSignature()`, um identificador determinístico formado pelo nome/identidade de playlist fictícia, IDs das mídias da base, IDs dos criativos, configuração normalizada e versão de programação de teste. **Não é assinatura criptográfica nem substitui validação do backend real.**
- O `createAutoBench()` grava no estado de **memória** a versão e a assinatura do programa de teste; `configure` atualiza esses campos e invalida a conclusão pendente do item anterior. `restoreAutoBench(checkpoint,currentProgram?)` verifica tanto o conteúdo do checkpoint quanto, quando fornecido, a revisão que seria entregue após o reinício.
- Se a playlist for alterada, o conjunto comercial mudar, os controles de agenda/aleatório/mídia única mudarem, a revisão for diferente ou a assinatura salva estiver incompatível, o laboratório **recusa a restauração e retorna com anúncios desativados**, mantendo somente as mídias fictícias do estabelecimento. O caso sem playlist continua em `Aguardando playlist`.
- Quando a revisão e o conteúdo coincidirem, o estado da simulação preserva rodada e posição, invalida o token anterior e só aceita um novo evento de conclusão para seguir.
- Novos testes `tests/commercial-tv-checkpoint-guard.test.cjs`: **6 cenários** incluindo revisão compatível, inventário comercial modificado, playlist modificada, estado corrompido, atualização de configuração e identidade estável — todos sem APIs, Storage, Supabase ou player real.
- **GitHub Actions: 166/166 testes aprovados, zero falhas**, https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38577894346 . A CI novamente confirmou que não houve mudanças no APK/player/device-gateway operacional, Netlify ou Vercel produção.
- A Vercel recusou o deploy anterior do laboratório automático devido à cota gratuita diária (HTTP 402). Ainda não há preview confirmado para a última versão; **não divulgar links de versões anteriores como se contivessem este recurso**. Aguardar liberação da cota e publicar *somente em preview*.
- Antes de qualquer integração real, ainda serão necessários identidade/versionamento confiáveis do manifesto, persistência efetiva de checkpoint no TV box, confirmação real de término das mídias, idempotência no backend e ensaio isolado em um dispositivo fictício. Nenhuma dessas tarefas foi considerada concluída apenas por esta simulação.

## Preview automático liberado após cota anterior — 14/10/2026

- **Atualização da situação anterior:** a Vercel passou a apresentar um deploy de preview `READY` para o commit de código `76dc601cf3e417ddb4e0b98d7152bfa3c70f0c93`, URL `https://vision-midia-digital-amtd2rhw8-vision-5529.vercel.app/commercial-tv-auto-bench.html`, `target:null` (não produção).
- O commit publicado contém `commercial-tv-auto-bench.html`, seus módulos de simulação, a verificação de compatibilidade de checkpoint e **166/166 testes aprovados** na CI. Não houve criação de outro projeto, promoção, alteração de Netlify ou deploy no Supabase.
- O serviço de busca externo não conseguiu abrir diretamente a rota e a API de listagem do conteúdo de deploy Git retornou `file tree not found`; portanto a URL foi **confirmada pela referência do deployment e pelo código associado**, mas a navegação/renderização no telefone depende de teste manual do operador.
- Correção explícita ao bloco histórico sobre HTTP 402: a limitação impediu a tentativa direta anterior, mas há agora um **preview automático** válido para o código da bancada. A publicação atual não indica que a experiência está liberada a TVs de clientes.

## Correção de UX da queda de conexão e reinício na bancada (14/10/2026)

- O operador enviou capturas em Android mostrando `Rodada 2 · item 5 de 8` e a mensagem `Conexão fictícia interrompida. Rodada e posição preservadas` após acionar `Simular queda da conexão`. A tela deixava o progresso suspenso sem instrução de recuperação visível; o botão `Simular reinício` preservava os dados sem feedback visual perceptível.
- **Corrigido exclusivamente em `commercial-tv-auto-ui.mjs` e `commercial-tv-auto-bench.html`**: a queda cancela o relógio de reprodução fictícia, exibe aviso **SEM CONEXÃO** próximo aos controles e agenda reconexão automática após cerca de **3 segundos**; `Reconectar agora` continua disponível e cancela a reconexão pendente.
- Se o modo automático estava em execução, a recuperação retoma o avanço do **mesmo item e rodada**; não força progresso enquanto a conexão fictícia está interrompida. Caso já estivesse pausado, permanece pausado depois de reconectar.
- O botão **Simular reinício** apresenta estado visual **REINICIANDO** por cerca de **2 segundos**, mantém os controles de avanço indisponíveis durante o processo e então usa o mesmo checkpoint de memória, restabelecendo a conexão fictícia se necessário. A rodada, item e contador não são avançados pelo reinício. Essa recuperação é simulada; não constitui persistência em hardware.
- O navegador em segundo plano cancela temporizadores de avanço/recuperação e não reproduz anúncios silenciosamente. Mensagens foram aproximadas dos botões com aviso acessível `role=status`, e as funções continuam limitadas a uma simulação offline sem acesso a Supabase, Storage, player ou TV real.
- Foram adicionados quatro testes de interação à regressão `tests/commercial-tv-auto-ui.test.cjs`, para recuperação temporizada, reinício durante desconexão, reconexão manual e comunicação visual. **170/170 testes PASS**, zero falhas, GitHub Actions https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38581345774 .
- A CI confirmou que os arquivos protegidos operacionais do player, APK, gateway e produção permaneceram intocados. O funcionamento pelo navegador do operador ainda depende de conferir o preview mais recente.

## Validação visual Android: pausa e reconexão fictícia (14/10/2026)

- O operador enviou dois prints do laboratório `commercial-tv-auto-bench.html`: o print durante a desconexão mostra o aviso **SEM CONEXÃO: simulação pausada**, o botão **Reconectar agora** disponível e os comandos de avanço desabilitados; o outro mostra a mensagem **Reconexão fictícia: mesma mídia e rodada, sem avanço**.
- O estado após a reconexão mostra **Rodada 1 · item 5 de 8**. Os prints são coerentes com a regra de conservar posição e rodada sem saltos na interrupção.
- **Limite da evidência:** as capturas não permitem cronometrar se a reconexão foi automática após três segundos ou acionada manualmente; não comprovam que o avanço automático continuou depois; tampouco mostram o botão **Simular reinício** em execução. Não afirmar essas três verificações como testes manuais concluídos.
- Testes automatizados correspondentes: **170/170 aprovados**, CI https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38581562886 . Código e produção não modificados nesta etapa, apenas documentação.
- **Próximo teste manual:** após a conexão retornar, iniciar/confirmar continuidade do avanço e acionar **Simular reinício** para visualizar estado REINICIANDO por 2 segundos e retorno à mesma rodada e posição.

## Botão de reconexão desativado com conexão já recuperada — UX do laboratório

- Captura no Android mostra o botão **Reconectar** visualmente desabilitado, junto da mensagem **Reconexão fictícia: mesma mídia e rodada, sem avanço**. Verificado que a conexão fictícia já tinha retornado, portanto o botão estava desabilitado **por design**. Isso não indica falha de reconexão.
- Para remover a ambiguidade, ajustado **somente** `commercial-tv-auto-ui.mjs`: quando a conexão está ativa, o controle mostra **Conectado ✓** e permanece indisponível; quando está desconectado, mostra **Reconectar agora** e fica habilitado; durante reinício mostra **Aguarde o reinício…**.
- Os três estados continuam dependentes exclusivamente da memória da bancada; nenhuma chamada remota, Supabase, TV, APK, player, URL de produção ou regra de reprodução foi modificada.
- Reforçados os testes de interação em `tests/commercial-tv-auto-ui.test.cjs`: verificam o estado conectado inicial, o botão durante a queda e o retorno à indicação **Conectado ✓** após reconexão automática.
- A UI de código foi aprovada na execução CI https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38599395171 . Verificar o CI mais recente após a alteração dos testes antes de afirmar que os testes novos foram executados.
