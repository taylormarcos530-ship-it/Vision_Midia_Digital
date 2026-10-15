# Vision Mídia Digital — checkpoint de auditoria RLS e separação de perfis

**Base preservada:** `ce165a987139b8403c79d6ebc73d6d6a6b19e2e6`  
**Branch de laboratório:** `fix/advertiser-portal-safety-20261013`  
**Sem alterações operacionais:** nenhum deploy, migration, Supabase remoto, atualização de APK, player, gateway ou playlist. Somente fixtures SQL em memória, testes e este relatório.

## Resultado executado

Novo `tests/commercial-rls-access-matrix.test.cjs`, sobre um **PGlite em memória**, com usuários fictícios de Master, anunciantes A/B, estabelecimento e visitante. O teste carrega o **script revisável e ainda não publicado** `supabase/sql/advertiser-portal.sql` e verifica diretamente as políticas RLS, grants, rotinas de portal, armazenamento fictício e isolamento entre contas.

**GitHub Actions:** 321/321 testes PASS, 0 FAIL; guardião de arquivos operacionais PASS.  
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38660946613

Foram verificados 10 subcenários SQL:

1. RLS habilitada nas 5 tabelas comerciais; `anon` sem SELECT e `authenticated` sem UPDATE direto.
2. Anunciante A vê apenas as próprias campanhas, revisões, destinos, contagens diárias e objeto comercial autorizado.
3. Anunciante B permanece isolado dos dados de A, tanto nas tabelas quanto no portal e Storage de fixture.
4. Estabelecimento, Master autenticado apenas como `authenticated` e conta sem vínculo não obtêm campanhas comerciais ou objetos via RLS.
5. Anunciante não pode modificar tabelas comerciais diretamente nem executar RPCs de Master/manifesto/delivery.
6. Conta anônima não pode consultar tabelas ou o portal.
7. RPC de relatório do Master exige uso da função privilegiada, com `p_actor` presente na tabela de administradores ativa.
8. Identidade de anunciante não pode ser promovida a administração da plataforma, associação a estabelecimento ou titularidade de empresa.
9. Campo sensível confirmado visível aos anunciantes (**pendência abaixo**).
10. Arquivamento/desabilitação oculta dados da conta A, revoga sua visão no portal e Storage e preserva a conta B.

Os testes são somente de estrutura e autorização SQL **local**. A fixture define `auth.uid()` por uma claim inserida no teste e **não valida tokens de um serviço real**.

## Achado de segurança — bloqueio para ativação

**Achado:** o contrato atual da tabela `vision_commercial_revisions` libera `GRANT SELECT` para o papel `authenticated`, com RLS por anunciante. Isso restringe as revisões à conta proprietária, mas **não restringe as colunas**. A revisão inclui `source_media_id` e `source_storage_path` da mídia original do estabelecimento; o portal `private.vision_portal_data` também retorna todas as colunas via `to_jsonb(r)`.

**Prova fictícia do teste:** o anunciante A conseguiu receber `source_media_id` e `source_storage_path='private-owner/point-media.webp'` tanto pela RPC do portal quanto por `SELECT source_media_id,source_storage_path FROM vision_commercial_revisions`. Não se verificou acesso direto ao arquivo; o problema constatado é **exposição de metadados internos**, não quebra comprovada da permissão de download ou acesso ao Supabase real.

**Status: PENDENTE / NÃO APROVADO PARA ANUNCIANTES REAIS.** A suíte geral PASS demonstra que os testes foram executados e reproduziram a exposição esperada; **não equivale a aprovação de segurança para habilitar o portal**.

### Correção mínima recomendada para futura homologação separada

- Criar projeções explícitas, revisadas, de campos visíveis ao anunciante (ID e nome da campanha, mídia comercial autorizada, formato, duração, status e métricas pertinentes), sem `source_media_id`, `source_storage_path`, `source_updated_at`, identificadores de mídia operacional, segredos ou outras informações internas do ponto.
- Trocar o `to_jsonb(r)` genérico da API por projeção explícita. **Isso sozinho é insuficiente:** revogar o SELECT de todas as colunas para `authenticated` em `vision_commercial_revisions` e permitir somente colunas públicas ou expor view/API com permissões específicas, levando em conta RLS, `security_invoker` e direitos do owner da view. Não afrouxar a separação entre anunciantes.
- Testar que a consulta direta das colunas sensíveis falha com `permission denied`, que a RPC não retorna esses campos, e que o anunciante ainda consegue visualizar sua peça comercial por um mecanismo de preview **com URL assinada e autorização escopada**. Validar também que Storage do ponto não pode ser acessado usando o caminho exposto.
- Auditar adicionalmente metadados de TV/destino (`device_id`, `last_seen_at`, `point_name`, `device_name`) e o nível necessário de detalhe no portal. Não mostrar tokens de TV, programação do estabelecimento ou nomes internos desnecessários.
- Conferir autenticação da API real e escopo `service_role`: a verificação de Master com `p_actor` funciona na fixture, mas o backend precisa vincular esse ID à sessão de usuário autenticada; o cliente não pode indicar outro Master.
- Verificar fluxo de arquivamento, bloqueio e rollback em **Supabase de homologação realmente isolado**, após autorização explícita, antes de qualquer anúncio real.

## Limites e próximos passos

Esta etapa não editou o script SQL, não criou migrations e não alterou `player.js`, `android-player/`, `supabase/functions/device-gateway/index.ts`, `playback_logs`, playlists ou TVs. O SQL consultado é somente uma versão revisável da branch. No estado atual não afirmar que o portal comercial está pronto ou que o Supabase remoto possui essas políticas.

**Próximo bloco seguro:** desenvolver e testar em SQL/PGlite **somente um patch de projeção mínima na bancada**, sem alterar o script revisável existente ou executar migrations, para provar que o anunciante recebe apenas campos autorizados e a visualização de comerciais não depende de caminhos internos do ponto.

**Regra permanente:** não promover produção, alterar Edge Functions, aplicar migrations ou atualizar player/APK sem autorização específica.
