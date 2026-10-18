# Vision Mídia Digital — ativação de contas de anunciantes (homologação, não liberada)

**Destino permitido para futura avaliação:** Supabase Homologação `jmiuitrrhtaeyrpuyohk`. A integração Vercel Preview continua desabilitada. Projeto de produção `fpadgedrgcxrrqflzhjt` e jogadores/TVs reais são explicitamente proibidos nesta etapa.

## Estado confirmado por leitura — 18/10/2026
- Projeto de homologação ativo com 2 contas Auth, 2 anunciantes e 2 campanhas, sem Master cadastrado, sem empresas e sem TVs.
- As 5 tabelas comerciais têm RLS, mas `authenticated` ainda consegue ler colunas internas de origem em `vision_commercial_revisions`; SQL-01 e SQL-02 continuam BLOQUEADOS.
- 0 Edge Functions publicadas no staging. Logo, `commercial_create_advertiser`, `commercial_reset_access` e outras ações dependentes de `master-admin` não funcionam remotamente.
- A conexão ao staging via link Supabase Vision mídia digital já foi identificada. NÃO confundir com a outra conexão Supabase de uma conta diferente.
- O mesmo projeto de homologação contém migrações de testes de Vision Menu; coordenar antes de qualquer escrita.

## Pacote pronto para revisão
- `supabase/sql/advertiser-staging-security-candidate.sql`: extraído do SQL de bancada previamente aprovado, não executado. Revoga SELECT integral na tabela de revisões, libera só 10 campos comerciais, projeta explicitamente a saída do RPC e impede execução direta do helper privado.
- `tests/commercial-staging-security-candidate.test.cjs`: verifica igualdade do SQL efetivo com o fixture já testado e impede mudanças fora do escopo.
- Nenhum arquivo operacional ou migration automática alterado.

## Para liberar o primeiro login de anunciante em staging
1. Obter autorização específica para mudança **somente** no projeto `jmiuitrrhtaeyrpuyohk`; confirmar escopo e conflitos com Vision Menu. Sem deploy ou escrita em produção.
2. Validar a alteração SQL contra as permissões/RPCs reais e preparar backup/retorno limitado a staging. Aplicar exclusivamente após aprovação e verificar SQL-01/SQL-02 em autenticação simulada A/B, incluindo `SELECT *` e privilégios por coluna.
3. Revisar e autorizar publicação isolada de `master-admin` e dependências comerciais no staging (sem credenciais de produção). Incluir flags `VISION_COMMERCIAL_ENABLED` apenas no ambiente de testes.
4. Criar Master fictício, anunciar A/B sintéticos sem reusar contas existentes; testar geração da senha, primeiro login, redefinição, revogação e isolamento cross-account; nenhuma senha em logs ou relatórios.
5. Executar as 17 condições do contrato de homologação, inclusive storage, links de mídia, dispositivos fictícios, reconexão e custo. Somente com prova e aprovação humana discutir rollout de produção.

**Critério de saída:** SQL seguro PASS, Auth completo PASS, RLS A/B PASS, isolamento comprovado, zero alteração nas TVs e produção. Não declarar homologado apenas com os testes unitários.
