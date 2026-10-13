# Vision Mídia Digital — checkpoint de homologação do anunciante (2026-10-13)

**Branch isolada:** `fix/advertiser-portal-safety-20261013`
**Base da feature preservada:** `87d907010db614d5459b6af9c7b421328e64f225`
**Estado:** preview ilustrativo disponível, produção intocada, homologação remota bloqueada até haver Supabase de teste independente.

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
