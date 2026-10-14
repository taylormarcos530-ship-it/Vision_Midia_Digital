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
