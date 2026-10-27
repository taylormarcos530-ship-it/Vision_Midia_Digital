# Vision Mídia Digital — resultado da recuperação isolada (26/10/2026)

## Escopo e preservação

**Nenhum dado de produção foi acessado ou copiado.** Teste executado em GitHub Actions, usando duas bases de dados isoladas PostgreSQL 17 e mídias fictícias oferecidas por um servidor HTTP local. Nenhum APK, Player, dispositivo, Vercel, Supabase, cliente real ou Storage real sofreu alteração. Nenhuma exportação real da empresa foi feita.

- Branch: `fix/vision-backup-foundation-isolated-20261026`.
- Código conhecido em produção: `736f58159de03cda86550472214943e73de5395c`.
- Resultado inicial do Work (cópia antiga do script): **17 PASS / 3 FAIL; restauração SQL bloqueada**.
- Rodada pós-correção, testes unitários de segurança: **16 PASS / 0 FAIL** — https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/40434678406
- Rodada pós-correção, integração de PostgreSQL 17.11 + age: **3 PASS / 0 FAIL** — https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/40435150324

## As três falhas do Work e as correções

1. **Mesmo número de arquivos com nomes trocados:** corrigido, o script exige igualdade do conjunto completo `(bucket, path)` entre catálogo SQL e Storage, além de confrontar tamanho/ETag, rejeitar entradas duplicadas e repetir a leitura do inventário durante e depois da captura.
2. **`--check` aceitava ferramentas PostgreSQL 16:** corrigido; `pg_dump`, `pg_restore` e `psql` precisam informar versão principal 17 tanto na conferência como antes do backup.
3. **Download parcial sem `Content-Length`:** corrigido; tamanho declarado no banco/metadados de origem é obrigatório; bytes obtidos precisam corresponder. Quando o ETag de origem tem formato MD5 de objeto único, o checksum também é verificado. Se não houver tamanho confiável, a exportação é recusada.

## Teste com banco verdadeiro

O GitHub Actions iniciou um serviço PostgreSQL 17.11 em container sob o usuário adequado, eliminando a limitação de ambiente da primeira rodada do Work. Foram criados registros fictícios de clientes, TVs, playlists, exibições, usuários Auth e metadados Storage, com chave de criptografia temporária.

A execução invocou a função real `full_backup`, o `pg_dump` e `pg_restore` reais e a criptografia `age` real. Descriptografou o arquivo, validou hashes SHA-256 das mídias e do dump e restaurou o banco em `vision_restored`. Conferiu contagem de registros por tabela, soma de exibições, integridade de relacionamentos, próxima chave sequencial, privilégios de leitura, ativação de RLS e filtro de tenant por `vision.tenant_id`. Também comprovou rejeição de nome trocado com contagem idêntica e de mídia curta sem `Content-Length`.

**Resultado: PASS** para recuperação isolada do conjunto de dados fictícios testado.

## O que ainda NÃO está validado

- Backup real da Vision armazenado fora do Supabase; não existe cópia operacional comprovada.
- Restauração integral de todos os schemas gerenciados, roles globais, secrets, Auth, integrações e todos os componentes específicos do projeto real em **outro projeto Supabase**. `pg_dump` lógico não exporta automaticamente todos os roles globais e configurações externas.
- Simultaneidade entre snapshot SQL e mudanças concorrentes no Storage: inventários antes/depois diminuem o risco, mas não garantem atomicidade absoluta; para operação em produção será necessário janela de consistência ou retenção/versionamento apropriado dos arquivos.
- ETag de formatos diferentes de MD5 simples não prova identidade de conteúdo só por igualdade de tamanho. Quando disponíveis, checksums independentes de origem devem ser preferidos.
- Envio automático das cópias para Google Drive, armazenamento de chaves de recuperação, retenção e alertas. Esses pontos exigem configuração posterior e controle do proprietário.

## Próxima etapa, mediante aprovação específica

1. Preparar a chave privada age em local sob controle do proprietário. A chave privada **não** deve ser colocada no chat ou em GitHub público/privado.
2. Definir o destino externo e confirmar política de retenção/recuperação.
3. Realizar exportação **somente de leitura**, em janela de baixo tráfego, após avaliar impacto no Nano.
4. Validar a descriptografia, inventários e um novo restore em ambiente realmente isolado; nunca restaurar sobre produção.
5. Configurar agendamento somente após prova de consistência, segurança e consumo.

**Status:** ferramenta testada em um cenário de restauração real com dados fictícios; **a continuidade de toda a Vision ainda não está garantida**.
