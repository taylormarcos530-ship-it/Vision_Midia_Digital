# Vision Mídia Digital — checkpoint: projeção segura do portal comercial (somente laboratório)

**Checkpoint de origem:** `74b16d15d038337c74c7e7186b0e77296ed6c7e4`  
**Branch:** `fix/advertiser-portal-safety-20261013`  
**Escopo:** correção demonstrada em PostgreSQL embarcado PGlite, exclusivamente com anúncios, empresas e mídias fictícias. **Não houve alteração de Supabase, Edge Functions, player, APK, playlists, schema de produção ou deploy.**

## Achado herdado e correção comprovada

Na auditoria anterior foi demonstrado que o SQL **revisável e ainda não publicado** `supabase/sql/advertiser-portal.sql` concede `SELECT` em todas as colunas de `public.vision_commercial_revisions` a usuários autenticados (sujeito à RLS por anunciante) e usa `to_jsonb(r)` para montar a resposta da função `private.vision_portal_data`.

Isso revela, mesmo com RLS correta, `source_media_id`, `source_storage_path` e `source_updated_at` da mídia de origem do estabelecimento. As consultas diretas à tabela também permitem ler esses campos. **A proteção de linhas (RLS) não substitui controles por coluna nem a projeção explícita de um RPC `SECURITY DEFINER`.**

### Artefatos criados, sem modificar o SQL oficial

- `tests/fixtures/commercial-safe-projection-lab.sql`: patch **marcado explicitamente como LAB FIXTURE ONLY / NOT A MIGRATION**. É aplicado pelo teste **somente depois** de carregar o SQL atual em um banco PGlite descartável. Revoga o `SELECT` completo de `authenticated` na tabela de revisões e concede `SELECT` somente a 10 campos comerciais permitidos: `id`, `campaign_id`, `name`, `media_type`, `storage_path` da **cópia comercial isolada**, `duration_seconds`, `size_bytes`, `width`, `height` e `created_at`. Não expõe `source_media_id`, `source_storage_path`, `source_updated_at` nem `checksum` original.
- O mesmo patch substitui **apenas na bancada** a função `private.vision_portal_data` por projeção explícita desses campos na lista `revisions`, mantendo outras seções funcionais do portal (`advertiser`, `campaigns`, `targets`, `daily`, horário do servidor). O helper privado continua sem `EXECUTE` para `anon` e `authenticated`.
- `tests/commercial-rls-safe-projection-lab.test.cjs`: 9 subcenários SQL em PGlite, com anunciante A/B, Master, estabelecimento, visitante e conta arquivada. Começa por um controle negativo que reproduz a exposição original; aplica a correção na memória e prova os resultados.

### Evidência dos testes

**GitHub Actions: 331/331 testes PASS, 0 FAIL; proteção de player e APIs operacionais PASS.**  
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38662392026

Os testes confirmam:

1. Antes do patch de laboratório, RPC e consulta direta revelam o caminho privado e ID da mídia original.
2. Depois do patch, tentativas de `SELECT source_storage_path`, `source_media_id`, `source_updated_at`, `checksum` e `SELECT *` são negadas por privilégios, inclusive para o anunciante proprietário da campanha.
3. A resposta `vision_advertiser_portal()` contém **somente as 10 propriedades permitidas** para cada revisão, sem caminho de origem, ID da mídia original ou hash original.
4. Anunciantes A e B preservam acesso apenas aos próprios dados, sem vazamento cruzado.
5. A política RLS de Storage continua entregando somente a cópia comercial permitida, e não a mídia base do ponto.
6. Anunciante não executa funções de Master nem escreve na tabela; Master com ator autorizado acessa o relatório na forma projetada.
7. Conta de estabelecimento, conta sem vínculo e `anon` continuam sem acesso aos registros comerciais.
8. Arquivar o anunciante suspende visibilidade de portal e Storage sem apagar os arquivos originais, sem alterar a outra empresa.
9. O teste verifica que `supabase/sql/advertiser-portal.sql` permanece byte a byte igual à versão que carregou, e que o gateway não importa nenhum módulo de laboratório.

## Restrições antes de qualquer integração futura

**Este teste não corrige o SQL oficial.** O achado de exposição de metadados no script revisável **permanece em aberto fora da bancada**. Não afirmar que o portal de anunciantes real esteja pronto, publicado ou protegido até uma implementação específica e nova homologação.

O patch de laboratório **não está pronto para uma migration automática**. É necessário revisar compatibilidade do painel e do Master com os campos removidos, políticas RLS/GRANT coluna a coluna, outras RPCs, rotas de geração de URL assinada, escopos de Storage e metadados de destino/TV. A função de Master na bancada recebe a mesma projeção reduzida; qualquer necessidade administrativa de informação interna deverá usar um caminho separado, com autorização própria e sem ser compartilhado ao anunciante.

Também não foi feita autenticação real de token, verificação de URL assinada, integração do player comercial, teste na TV Box Smart Pro 3000, banco Supabase remoto ou mensuração de impressões reais. Esses são portões de aprovação independentes.

## Próxima etapa segura

Validar **contrato de compatibilidade do frontend do portal** contra a resposta reduzida (sem URLs de mídia do ponto e sem perda de funções úteis), com testes isolados de JavaScript/HTML e análise de todas as rotas comerciais de pré-visualização. Não aplicar migration, não publicar Edge Function e não habilitar a flag comercial. Exigir aprovação separada para qualquer staging real.

## Salvaguardas permanentes

- Não modificar `player.js`, `android-player/`, playlists, `device-gateway/index.ts`, `public.playback_logs` ou clientes em uso.
- Não alterar o SQL oficial sem plano de aprovação; fixture reside somente sob `tests/`.
- Não promover Netlify/Vercel, APK ou Supabase remoto.
- Todo status PASS descreve **laboratório** e não uma ativação comercial real.
