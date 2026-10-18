# Vision Mídia Digital — resultado da integração comercial em homologação (18/10/2026)

**Ambiente autorizado:** Supabase `jmiuitrrhtaeyrpuyohk` — **somente homologação**.
**Produção intocada:** Supabase `fpadgedrgcxrrqflzhjt`, domínio oficial Vercel, Player, APK, TVs e playlists.

## Mudanças executadas com autorização

1. Migration aplicada: `20261018120533 staging_commercial_safe_projection_20261018`, adaptada exclusivamente do SQL já testado. Protege leitura de `source_media_id`, `source_storage_path`, `source_updated_at`, `checksum` e projeta resposta segura da função privada.
2. Edge Function `master-admin` v1, **somente em homologação**, `verify_jwt=true`, status ACTIVE. Código: `supabase/functions/commercial-staging-master/index.ts`. Permite somente ações comerciais de cadastro/acesso; impede operações com TVs, playlists, campanhas operacionais e publicação. Ambiente validado por host exato no código.
3. Testes do código: **683/683 PASS** na branch isolada, incluindo 15 verificações direcionadas ao patch e ao endpoint comercial.
4. HTTP remoto: chamadas ao Master sem autenticação e com token inválido retornaram HTTP 401; consulta anônima à função do portal e ao campo privado também HTTP 401.
5. SQL remoto: `authenticated` sem SELECT na tabela inteira de revisões, sem SELECT nos quatro campos sensíveis; helper privado não executável; resposta do helper sem referência de origem.
6. Simulação SQL `authenticated` com identidades fictícias A/B existentes, em transações `READ ONLY` e encerradas por `ROLLBACK`: cada identidade obteve uma campanha própria; origem de mídia não exposta.
7. Conferido o isolamento do Vision Menu: esquema `vision_menu_lab` e 1 rascunho permanecem intactos. Foram preservados 2 usuários Auth, 2 anunciantes, 2 campanhas já existentes; 0 TV real e 0 empresas em staging.

## Bloqueio restante (não interpretar como homologação concluída)

A ferramenta bloqueou a tentativa de criar uma nova conta Master de teste. **Nenhuma conta nova foi criada.** O banco permanece com `platform_admins=0`.

Assim, o fluxo HTTP real **criar usuário -> gerar senha temporária -> login no Portal -> troca de senha -> revogação** ainda não pôde ser testado ponta a ponta. A função Edge está ativa, mas sua autorização Master não foi validada com sessão de teste real. Não reutilizar contas existentes nem copiar credenciais de produção.

Sem solução legítima para a conta Master sintética e posterior teste de login, **não conectar o Master comercial à produção e não habilitar anúncios reais**.

## Estado final

- Não realizar novamente a migration de segurança: já aplicada.
- Não publicar novamente a mesma Edge Function sem avaliar a versão existente (v1 ativa).
- Não alterar schemas de Vision Menu.
- A interface comercial oficial segue desconectada; a Preview segura do Master exibe “Anunciantes · Em homologação”.
- Necessário credenciamento legítimo de conta Master exclusivamente fictícia no projeto staging, seguido de teste completo e auditoria das demais condições comerciais (Storage, mídia e TV fictícia) antes da produção.
