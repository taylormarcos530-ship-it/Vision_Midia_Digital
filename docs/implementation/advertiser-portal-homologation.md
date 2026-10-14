# Vision Mídia Digital — checkpoint de homologação do anunciante (2026-10-13)

**Branch isolada:** `fix/advertiser-portal-safety-20261013`
**Base da feature preservada:** `87d907010db614d5459b6af9c7b421328e64f225`
**Estado atualizado:** projeto de homologação independente criado e esquema instalado; segurança RLS validada no banco de teste; login HTTP preparado em página exclusiva, aguardando contas fictícias no Supabase Auth. Produção intocada.

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
