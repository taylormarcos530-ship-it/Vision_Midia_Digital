# Vision Mídia Digital — Etapa 1: Proteção e recuperação dos dados

**Status:** preparação isolada. Esta documentação e o utilitário **não são um backup concluído**; será necessário executar uma exportação real, guardar a chave de recuperação e testar uma restauração separada.

## O que já foi verificado (26/10/2026)

- Projeto Supabase de produção: `fpadgedrgcxrrqflzhjt`, PostgreSQL 17 no plano Free/Nano.
- Banco estimado em ~159 MB, 79 metadados de objetos Storage, 13 usuários Auth, 34 dispositivos, 143.302 registros de exibição no momento da consulta.
- A produção Vercel corresponde ao deployment `dpl_6J9uYSN23B51D9B5EUKJ6MA6YPRg`, commit `736f58159de03cda86550472214943e73de5395c`. GitHub `main` **não** é o commit de produção; portanto não usar `main` como referência de rollback.
- Branch imutável por convenção: `backup/vision-production-known-good-20261026` partindo do commit acima. Esta branch preserva código, **não** dados do banco e **não** arquivos do Storage.
- Supabase `device-gateway` v19 é parte do estado recuperado; registrar também versões e configuração das outras Edge Functions.

## Por que backup independente

O Free não inclui backups diários gerenciados. Arquivos enviados ao Storage não fazem parte de um backup lógico do banco. A documentação recomenda exportações fora da plataforma:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/reference/cli/supabase-inspect-db-role-configs

**IMPORTANTE: Este repositório é público. Não enviar dumps, vídeos privados, chaves de serviço, URLs de conexão ou arquivos de backup, mesmo de teste, para commits ou pull requests.** O arquivo final tem criptografia `age`, e a chave privada deve ficar **fora** do GitHub e do Supabase.

## Funcionamento do utilitário (somente leitura)

Arquivo: `scripts/vision-backup/backup.py`

1. Usa `pg_dump` PostgreSQL 17 para criar um dump lógico customizado com estrutura e dados de todos os schemas acessíveis, incluindo Auth, RLS, propriedade e permissões.
2. Confere formato do dump com `pg_restore -l` e exige presença da tabela `auth.users`.
3. Lista todos os buckets e arquivos do Storage via API autenticada, baixa uma mídia por vez, calcula hashes SHA-256 e compara a contagem com `storage.objects`.
4. Cria manifesto e um único arquivo `tar.gz.age`, criptografado com a chave pública fornecida. Os arquivos temporários sem criptografia são removidos ao término da execução.
5. Rejeita saída existente; não sobrescreve, exclui nem altera nenhuma tabela ou arquivo do Supabase. Não executa migração, trigger, cache reset ou deploy.

**Limitações:** o dump bruto retém objetos gerenciados Supabase que exigem planejamento específico de restauração. Não inclui configurações do console, variáveis privadas de Edge Functions, certificados/domínios, segredos OAuth ou arquivos que não estiverem no Storage. O inventário dessas configurações precisa ser mantido separadamente, sem expor os valores secretos.

## Como executar sem compartilhar senha no chat

**Pré-requisitos (computador próprio confiável):** Python 3.11+, clientes `pg_dump`, `pg_restore` e `psql` compatíveis com PostgreSQL 17; [age](https://github.com/FiloSottile/age) instalado. Não executar diretamente em TV Box.

1. Gere uma chave privada local: `age-keygen -o /caminho/seguro/vision-recovery.key`. Anote a chave **pública** `age1...`, guarde a chave privada em duas cópias seguras e separadas. Sem ela, a cópia criptografada fica irrecuperável.
2. No painel Supabase, abra **Connect**, obtenha a URL de conexão do projeto Vision (preferir Session Pooler com SSL), e nas configurações de API encontre a chave `service_role` **privada**.
3. Configure variáveis de ambiente **somente no computador confiável**, sem colocá-las em histórico, scripts, logs ou Git:
   - `VISION_BACKUP_DATABASE_URL` = URL PostgreSQL da Vision.
   - `VISION_BACKUP_SUPABASE_URL` = `https://fpadgedrgcxrrqflzhjt.supabase.co`.
   - `VISION_BACKUP_SERVICE_ROLE_KEY` = chave privada de serviço.
   - `VISION_BACKUP_AGE_RECIPIENT` = chave pública `age1...`.
4. Rode `python3 scripts/vision-backup/backup.py --check` para validar ferramentas **sem acessar** produção.
5. Quando autorizado e fora do horário crítico, rode `python3 scripts/vision-backup/backup.py --output /CAMINHO-FORA-DO-REPO/vision-$(date +%F-%H%M).tar.gz.age`.
6. Não copie o arquivo `.age` para o repositório. Faça duas cópias em destinos separados, preferindo mídia externa e nuvem privada, com acesso restrito.

Se ocorrer qualquer erro, o programa informa **Backup NOT completed** e não declara sucesso. Um arquivo `.age` não substitui a verificação de restauração.

## Verificação real e recuperação

Antes de depender deste backup:
- Descriptografar uma cópia num ambiente **local/isolado**, nunca em produção, com `age --decrypt --identity /CAMINHO/vision-recovery.key -o /TMP/vision.tar.gz /CAMINHO/vision.tar.gz.age`.
- Inspecionar `manifest.json`, conferir hashes do `database.dump` e das mídias com programa de verificação.
- Testar `pg_restore` em PostgreSQL descartável, inspecionar tabelas, papéis, RLS, permissões e `auth.users`. Importar cegamente schemas gerenciados em outro projeto Supabase **não é permitido**; adaptar as instruções oficiais para restauração/transferência e validar no ambiente de teste.
- Validar arquivos de mídia separadamente, login de conta de **teste**, pareamento de TV de teste, playlist, vencimento e histórico.
- Registrar data, tamanho, contagem de objetos e resultado de restauração.

**Regra de ouro:** nenhum backup ou restauração desta fase altera a produção sem autorização específica. Não automatizar backup frequente no Nano antes de medir o impacto no I/O. A cópia é etapa inicial, não garantia de recuperação automática.

## Pontos ainda dependentes de acesso/execução

- Os conectores disponíveis não expõem uma operação de `pg_dump`/exportação completa nem fornecem credenciais SQL de backup. **Ainda não foi gerado nem verificado um arquivo de backup real.**
- O plugin GitHub não permitiu consultar a proteção da branch principal (HTTP 403) e a API de rulesets retornou lista vazia: **não afirmar que branch protection está ativa.** A proteção técnica de deploy é etapa posterior.
- Testes completos de restauração e estratégia de cópia recorrente off-site vêm depois da primeira exportação validada, sempre sem mexer nas TVs ativas.
