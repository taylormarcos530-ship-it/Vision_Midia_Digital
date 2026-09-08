# Vision Mídia Digital

Plataforma SaaS de digital signage em desenvolvimento com painel do cliente, Painel SaaS Master, backend Supabase multiempresa, programação automática, Vision Player Web, monitoramento operacional e prova de veiculação.

## Fluxo atual

Master SaaS → clientes/planos/limites → Painel do cliente → Supabase → Programação → Vision Player → TV → telemetria/logs → Monitoramento + Relatórios.

## Painel SaaS Master

Arquivo: `master.html`.

O Master é separado do painel operacional do cliente para reduzir risco de regressão e limitar o uso de operações administrativas privilegiadas.

Recursos implementados:

- dashboard SaaS com total de contas, usuários, TVs, TVs online, armazenamento e MRR estimado;
- cadastro de empresa/cliente e usuário proprietário em uma única ação;
- convite por e-mail ou criação com senha temporária;
- plano e período de teste no cadastro;
- pesquisa de clientes;
- ativação e suspensão de contas;
- plano, status da assinatura, preço mensal manual e observações de cobrança;
- limites personalizados por empresa;
- usuários por empresa com papéis `owner`, `admin`, `operator` e `viewer`;
- ativação/desativação de membros não proprietários;
- redefinição de senha temporária pelo Super Master;
- criação e edição de planos;
- auditoria das ações do Master.

### Perfis da plataforma

- `super_admin`: acesso total, incluindo planos e redefinição administrativa de senha;
- `admin`: gestão de clientes e usuários, sem editar planos nem redefinir senha administrativa;
- `support`: leitura do painel Master, sem alterações.

As permissões Master não ficam em `user_metadata`. Elas são armazenadas em tabela interna e verificadas no backend.

### Primeiro acesso Master

O e-mail `taylormarcos530@gmail.com` está na allowlist privada como `super_admin`.

Esse e-mail ainda precisa existir e estar confirmado no Supabase Auth. No primeiro acesso:

1. abra `index.html`;
2. crie a conta com o e-mail autorizado;
3. confirme o e-mail, caso a confirmação esteja habilitada;
4. abra `master.html` e entre com a mesma conta.

Ao confirmar um e-mail presente na allowlist privada, o backend cria/atualiza automaticamente sua permissão Master. A allowlist não é enviada ao navegador.

## Planos e limites SaaS

Planos iniciais editáveis:

- Start — R$ 49/mês, 1 TV, 2 GB, 2 usuários, 10 campanhas;
- Pro — R$ 99/mês, 5 TVs, 10 GB, 5 usuários, 50 campanhas;
- Business — R$ 199/mês, 20 TVs, 50 GB, 15 usuários, 250 campanhas.

Esses valores são apenas configuração inicial e podem ser alterados pelo Super Master.

Os limites são aplicados no backend para:

- TVs;
- usuários da empresa;
- campanhas;
- armazenamento de mídia.

O armazenamento possui duas camadas: validação em `media_assets` e política RLS no Supabase Storage. Se o upload normal terminar mas o registro da mídia falhar por limite, o frontend tenta remover imediatamente o objeto recém-enviado para evitar arquivo órfão.

Limites personalizados por empresa podem sobrescrever os limites do plano sem alterar o plano global.

## Suspensão comercial

Uma conta suspensa não é apenas escondida no visual:

- o cliente não pode alterar o próprio `companies.status`;
- novas TVs, usuários, campanhas e mídias são bloqueados;
- alterações de playlists, itens, atribuições e alvos de campanha são bloqueadas;
- o Master marca as TVs como `disabled`;
- o player existente deixa de ser autorizado pelo gateway;
- ao reativar a conta, as TVs voltam para `offline` até novo heartbeat.

`past_due` permanece operacional por enquanto para permitir uma futura política de carência. `suspended` e `cancelled` bloqueiam o serviço.

## Backend

Supabase:

- Auth por e-mail/senha;
- PostgreSQL com RLS multiempresa;
- Storage privado `vision-media`;
- pareamento seguro de dispositivos;
- credencial própria por TV;
- playlists e atribuição padrão;
- campanhas e programação;
- heartbeat e telemetria;
- eventos de erro/recuperação;
- logs de reprodução;
- prova de veiculação;
- planos, assinaturas e limites;
- auditoria Master.

Tabelas SaaS principais:

- `platform_admins`;
- `plans`;
- `company_subscriptions`;
- `master_audit_logs`.

A allowlist de administradores da plataforma fica em `private.platform_admin_allowlist`.

## Edge Functions

- `device-bootstrap` — pareamento;
- `claim-device` — autorização do código;
- `device-gateway` — programação, manifesto e prova de veiculação;
- `device-monitoring` — heartbeat e eventos operacionais;
- `master-admin` — operações administrativas SaaS do Painel Master.

`master-admin` exige JWT de usuário válido e depois confirma que o usuário é administrador ativo da plataforma antes de usar a chave secreta do backend.

A secret key nunca é enviada ao navegador.

## Painel do cliente

- login, cadastro e recuperação;
- empresas isoladas por RLS;
- TVs e pareamento por código;
- biblioteca de imagens/vídeos;
- playlists;
- playlist padrão por TV;
- Programação/Campanhas;
- Monitoramento Operacional;
- Relatórios / Prova de Veiculação.

## Vision Player Web

Abra `player.html` em navegador/TV Box.

O player 1.2:

- pareia por código temporário;
- sincroniza manifesto;
- baixa imagens/vídeos para cache local;
- reproduz conteúdo sincronizado offline;
- troca automaticamente campanhas e fallback;
- envia heartbeat/telemetria;
- registra falhas e recuperações;
- guarda filas offline;
- registra prova de veiculação.

## Segurança

- frontend e player usam somente publishable key;
- nenhuma `sb_secret_` ou `service_role` é embarcada no navegador;
- RLS isola empresas;
- tabelas Master internas não têm acesso direto de clientes;
- `platform_admins` e `master_audit_logs` têm policy explícita de negação direta;
- credenciais de TVs são armazenadas como hash;
- status comercial da empresa não pode ser alterado pelo próprio cliente;
- quotas principais são aplicadas no backend;
- Security Advisor deve ser executado após migrations.

## Arquivos principais

- `index.html` / `app.js` / `styles.css` — painel do cliente;
- `master.html` / `master.js` / `master.css` — Painel SaaS Master;
- `player.html` / `player.js` / `player.css` — player;
- `sw.js` — PWA do painel do cliente;
- `supabase/functions/*` — Edge Functions;
- `supabase/migrations/*` — migrations disponíveis no pacote;
- `QA_STATUS.md` — testes e limitações.

O Painel Master não é colocado no cache offline do Service Worker propositalmente: ações administrativas devem trabalhar com dados atuais do backend.

## Ainda não implementado

- cobrança automática por gateway (Mercado Pago/Stripe etc.);
- geração automática de fatura;
- webhook de pagamento e mudança automática de `past_due`/suspensão;
- E2E real do Painel Master em URL publicada;
- E2E real em TV/TV Box;
- APK Android/kiosk e auto-start no boot;
- alertas externos push/e-mail/WhatsApp.

O módulo atual já fornece a fundação SaaS para cadastrar e controlar clientes; billing automático é a próxima camada comercial.

## Release Candidate final

Esta pasta está limpa para preview/homologação e inclui `vercel.json` e `netlify.toml` com headers básicos de segurança. Os arquivos temporários usados em QA foram removidos.

Antes de comercializar como produção homologada, publique esta mesma release em uma URL de preview e execute o E2E de login, criação de empresa, Master, pareamento e reprodução em um TV Box real.
