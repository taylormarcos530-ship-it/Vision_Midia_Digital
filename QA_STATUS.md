# QA — Vision Mídia Digital (Painel SaaS Master)

## Status

A fundação SaaS e o Painel Master foram implementados no Supabase real e nos arquivos locais do projeto.

Esta etapa está classificada como **implementada + testes reais de banco + validação estática do frontend**. Ainda não está classificada como E2E completo do Painel Master, porque a conta Master autorizada ainda não existe no Supabase Auth e a interface não foi publicada em uma URL de preview para um fluxo de login real.

## Implementado

### Painel Master separado

`master.html` / `master.js` / `master.css`:

- login Master;
- bloqueio de usuários não autorizados;
- Dashboard SaaS;
- clientes/empresas;
- planos;
- auditoria;
- cadastro de cliente + proprietário;
- convite por e-mail ou senha temporária;
- período de teste;
- suspender/reativar;
- plano/status/preço manual/notas de cobrança;
- overrides de limites;
- usuários por empresa;
- desativação/ativação de membros;
- redefinição de senha temporária pelo Super Master;
- criação/edição de planos pelo Super Master.

### Segurança Master

- `platform_admins` não é gravado a partir de `user_metadata`;
- allowlist fica em `private.platform_admin_allowlist`;
- `master-admin` exige JWT válido;
- depois do JWT, `master-admin` consulta `platform_admins` no backend;
- `support` é somente leitura;
- `admin` gerencia clientes/usuários;
- `super_admin` também gerencia planos e senha administrativa;
- `platform_admins` e `master_audit_logs` não possuem grants diretos para clientes;
- RLS ativo + policies explícitas de negação direta nessas tabelas.

O e-mail `taylormarcos530@gmail.com` está na allowlist como Super Master, mas a consulta ao Auth confirmou que esse usuário ainda **não existe** no projeto. Ele será promovido quando a conta for criada e confirmada.

## Edge Function Master

`master-admin`:

- status: **ACTIVE**;
- versão: **2**;
- `verify_jwt=true`;
- secret key somente no ambiente da Edge Function;
- fonte local presente em `supabase/functions/master-admin/index.ts`.

Ações implementadas:

- `whoami`;
- `dashboard`;
- `create_client`;
- `update_company`;
- `save_plan`;
- `add_user`;
- `update_member`;
- `set_user_password`.

## Testes reais de limites — Postgres

Executados dentro de transação descartável e revertidos com rollback.

Resultado: **9/9 PASS**.

- primeira TV dentro do limite — PASS;
- segunda TV acima do limite — bloqueada com `plan_device_limit_reached`;
- segundo usuário dentro do limite — PASS;
- terceiro usuário acima do limite — bloqueado com `plan_user_limit_reached`;
- primeira campanha dentro do limite — PASS;
- segunda campanha acima do limite — bloqueada com `plan_campaign_limit_reached`;
- mídia abaixo do limite de storage — PASS;
- mídia acima do limite — bloqueada com `plan_storage_limit_reached`;
- empresa suspensa — nova operação bloqueada com `company_suspended`.

## Testes de acesso Master

### Promoção automática

Foi criado um e-mail QA temporariamente na allowlist e um usuário Auth confirmado dentro de transação.

Resultado:

- `promoted_to_master = true` — PASS.

A transação foi revertida.

### Cliente não pode alterar status comercial

Foi simulado um proprietário autenticado tentando alterar `companies.status` diretamente.

Resultado esperado recebido:

- `P0001: company_status_managed_by_platform` — PASS.

Isso impede o cliente de reativar uma conta suspensa pelo navegador.

## Storage SaaS

Além do limite em `media_assets`, foi adicionada validação RLS para uploads no bucket `vision-media`.

Teste com tenant temporário de limite 1 MB:

- upload hipotético de 700.000 bytes: permitido — PASS;
- upload hipotético de 1.500.000 bytes: negado — PASS.

A função também verifica papel da empresa e estado comercial antes do upload.

O teste de uma transferência binária real pelo Storage API ainda faz parte do E2E de preview.

## Suspensão

O Master, ao suspender/cancelar uma conta:

- altera o estado comercial;
- marca TVs como `disabled`;
- o `device-gateway` existente rejeita dispositivos disabled;
- triggers bloqueiam novas operações e mutações de conteúdo relevantes.

Ao reativar, TVs `disabled` voltam para `offline` e precisam comunicar heartbeat novamente.

## Dados de QA restantes

Verificação final no banco:

- usuários `qa-%@vision.test`: **0**;
- empresas `qa-%`: **0**;
- platform admins QA: **0**.

Nenhum dado de teste desta etapa ficou persistido.

## Security Advisor

Após as migrations SaaS, o Advisor inicialmente indicou duas tabelas RLS sem policy: `platform_admins` e `master_audit_logs`.

As tabelas já não tinham grants de cliente, mas foram adicionadas policies explícitas `USING (false)` como defesa em profundidade.

Resultado final:

- **Supabase Security Advisor: 0 alertas**.

## Performance Advisor

Resultado final:

- nenhuma FK nova sem índice;
- apenas avisos `unused_index`.

Os avisos `unused_index` são esperados nesta fase sem tráfego/uso real e não foram removidos prematuramente.

## Validação estática dos arquivos

Sintaxe JavaScript:

- `master.js`: PASS (`node --check`);
- `app.js`: PASS;
- `player.js`: PASS.

HTML / referências:

- `master.html`: 85 IDs, 0 duplicados;
- referências estáticas do Master: 74, 0 ausentes;
- `index.html`: 145 IDs, 0 duplicados;
- referências estáticas do painel: 128, 0 ausentes;
- `player.html`: 14 IDs, 0 duplicados;
- referências estáticas do player: 13, 0 ausentes.

Outros:

- manifests JSON: válidos;
- scan de segredos em arquivos públicos: **0 ocorrências** de `sb_secret_`, `service_role`, `SUPABASE_SECRET` ou chave privada;
- `master-admin` local contém a lógica da versão 2;
- migrations SaaS desta etapa foram adicionadas ao pacote local.

## Limitações / E2E ainda obrigatório

1. Criar e confirmar `taylormarcos530@gmail.com` no Auth do próprio app.
2. Entrar em `master.html` e confirmar papel `super_admin` real.
3. Publicar uma URL de preview.
4. Pelo Master, criar um cliente real de teste.
5. Testar convite por e-mail; a entrega depende da configuração de e-mail/SMTP do Supabase.
6. Entrar com o cliente criado e confirmar limites pelo frontend.
7. Suspender a empresa e confirmar que painel/player deixam de operar como esperado.
8. Reativar e confirmar retomada.
9. Fazer upload real pelo Storage API abaixo e acima da quota.
10. Executar E2E em TV/TV Box.

## Billing

O painel já possui plano, trial, preço manual, status de assinatura e suspensão, mas **não existe cobrança automática nesta etapa**. Mercado Pago/Stripe, webhook de pagamento, inadimplência automática e faturas ainda são próximos módulos, não foram simulados como prontos.

## Fechamento da release candidata

Validação local final em 2026-09-08:

- `index.html`: HTTP 200
- `master.html`: HTTP 200
- `player.html`: HTTP 200
- JS principal (`app.js`, `master.js`, `player.js`): sintaxe válida com `node --check`
- manifests JSON: válidos
- `vercel.json`: válido
- arquivos temporários de QA removidos do pacote final
- headers de hardening preparados para Vercel e Netlify
- Security Advisor do Supabase: 0 alertas na última verificação

### Pendências que impedem chamar de produção 100% homologada

- E2E real em URL pública não executado porque o deploy via integração exigiu confirmação externa e não foi concluído.
- E2E em TV/TV Box físico ainda pendente.
- o usuário Super Master `taylormarcos530@gmail.com` ainda precisa existir/ser confirmado no Supabase Auth para testar o primeiro acesso real ao Master.
- cobrança automática por gateway continua fora desta release; cobrança pode ser controlada manualmente pelo Master.

Status desta entrega: **Release Candidate / pré-produção**, pronta para publicação de preview e homologação final.
