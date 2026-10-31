# Vision V2 — Replay de arquivo criptografado por segmento, sem ledger permanente por evento

**Data:** 31/10/2026  
**Escopo:** somente branch `experiment/vision-v2-sequence-watermark-qa-20261031`, PostgreSQL 17 em contêiner descartável, HTTP em 127.0.0.1 e arquivos locais temporários criptografados. **Sem deploy, Supabase, APK, site, painel ou TVs.**

## Resultado final verificado

- **PASS: 18 testes; FAIL: 0; ERROR: 0; skipped: 0**, GitHub Actions [run 41236124709](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41236124709), commit testado `f6a0b8dc90b54d576b4133360c1937dec7a95f14`. Log: `Ran 18 tests in 10.467s`, `OK`, `ENCRYPTED_ARCHIVE_REPLAY=PASS`.
- A execução [41236040509](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41236040509) havia passado 16 testes antes de dois novos casos de segurança.
- A primeira execução [41235992201](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41235992201) **falhou** ao importar `server.py` porque o PYTHONPATH não apontava para `quarantine-qa`. Foi corrigido somente o workflow experimental; não houve falha do PostgreSQL ou reprodução nesse run.

### Arquivos apenas na branch experimental

- [archive_schema.sql](../../tests/vision-v2-sequence-qa/archive-replay-qa/archive_schema.sql): manifesto de segmento, intervalo, contagem, hash SHA-256 do arquivo cifrado, hash do conteúdo decifrado, versão da chave. Uma linha por segmento; **nenhum ledger permanente adicional por evento**. Trigger nega UPDATE/DELETE do manifesto.
- [archive_replay.py](../../tests/vision-v2-sequence-qa/archive-replay-qa/archive_replay.py): exportação criptografada AES-256-GCM com nonce aleatório; arquivo temporário + fsync + rename; restauração para SQLite independente; replay exclusivamente via arquivos + manifestos, sem SELECT de comprovantes originais.
- [test_archive_replay.py](../../tests/vision-v2-sequence-qa/archive-replay-qa/test_archive_replay.py): 18 testes automáticos reais de integração em PostgreSQL + HTTP loopback.
- [vision-v2-archive-replay-qa.yml](../../.github/workflows/vision-v2-archive-replay-qa.yml): workflow sem ações de deploy, branch isolada, PostgreSQL descartável e chave **fictícia publicada no próprio workflow; jamais usar essa chave real**.

### Modelo de arquivo, manifesto e ACK

1. O exportador QA consulta em leitura comprovantes de um único dispositivo/stream em intervalo fechado e contíguo, com tamanho máximo de 100 provas por segmento. Cria envelope criptografado AES-256-GCM, associado criptograficamente à identidade da empresa, dispositivo, stream e intervalo via AAD.
2. Depois de persistir o arquivo cifrado local, registra **uma linha de manifesto por segmento** em PostgreSQL, com hashes e contagem. Falha ao registrar manifesto deixa arquivo órfão que **não é reconhecido pelo replay** e exige rotina futura de recuperação.
3. O endpoint QA `POST /qa/archive-replay` recebe sequências já confirmadas e payloads completos. Ele autentica com token fictício, lê manifesto, verifica SHA-256 do arquivo, integridade AES-GCM, AAD, hash interno do segmento, sequência contígua e hash de cada comprovante requisitado.
4. **Papel SQL de leitura restrita:** `v2_archive_reader_qa` pode ler somente metadados de dispositivo e manifestos; a tentativa de SELECT de `v2_quarantine_qa.receipts` retornou erro `permission denied` esperado. Os originais permaneceram no PostgreSQL, mas o caminho de replay não tem privilégios para lê-los — simulação verificável de busca apenas em arquivo.
5. Só depois de verificar **o lote completo**, responde com o `watermark` que já existia. **Nunca grava nem avança ACK**. `accepted=0`, `billable=0`; replay não transforma comprovantes sem horário em anúncios datados.
6. Arquivo indisponível, truncado, adulterado, chave errada ou manifesto ausente → erro, **nenhum novo ACK**. Payload divergente → conflito. Pedido acima do watermark → conflito.
7. Restauro de um segmento em SQLite independente com `PRAGMA integrity_check` e contagem validada. Nunca sobrescreve SQLite já existente, não apaga originais e não executa migrations no Supabase.

### Evidências literais do log

```text
DISPOSABLE_PG17_AND_RESTRICTED_ROLE=PASS
QA_ARCHIVE_ONLY_ACK_PASS archived_replay=2 ack=64 originals_unchanged=true
QA_ARCHIVE_MULTISEGMENT_FAIL_CLOSED_PASS no_partial_ack=true
QA_ARCHIVE_RESTORE_PASS source_count=64 restored=32 encrypted_bytes=10138
QA_ARCHIVE_RECOVERY_PASS archive_unavailable_then_restored=true
QA_ARCHIVE_MANIFEST_IMMUTABLE_PASS
QA_ARCHIVE_PG_PRIVILEGE_PASS no_original_receipts_select=true
QA_ARCHIVE_CONCURRENCY_PASS workers=6 verified_replays=192 new_ack=0
Ran 18 tests in 10.467s
OK
ENCRYPTED_ARCHIVE_REPLAY=PASS
NO_DEPLOY=true NO_SUPABASE=true NO_ORIGINAL_DELETION=true
```

### PASS/FAIL: casos de falha deliberada, sem falsa aprovação

| Condição ensaiada | Esperado | Resultado |
|---|---|---|
| Arquivo ausente/truncado/cifrado adulterado | Falhar fechado sem ACK | PASS |
| Chave de criptografia errada | Falhar fechado | PASS |
| Payload reapresentado com mídia alterada | Rejeitar conflito | PASS |
| Sequência ainda não confirmada | Nunca avançar watermark | PASS |
| Lote cruzando para segundo segmento sem arquivo | Sem confirmação parcial | PASS |
| Manifesto SQL não gravado após criação do arquivo | Arquivo órfão sem ACK | PASS |
| ENOSPC simulado no arquivo temp | Não publicar arquivo/manifesto | PASS |
| Reinício simulado antes de renomear arquivo | Sem arquivo/manifesto confirmado | PASS |
| Manifesto já registrado | UPDATE rejeitado | PASS |
| Token errado / stream errado | Não ler arquivo do outro stream | PASS |
| Restaurar em SQLite novo | Contagem e integridade corretas | PASS |
| 6 reenvios concorrentes de 32 comprovantes | 192 verificações, ACK não avançar | PASS |
| SELECT dos originais pela role de replay | Acesso negado | PASS |

## Limitações e NO-GO (obrigatórias)

- **Nenhum comprovante original foi excluído ou movido da tabela principal.** A simulação de "somente arquivo" é feita retirando o acesso SQL ao original, e NÃO corresponde à migração física depois de DELETE. Não autoriza expurgo real.
- O arquivo chamado "externo" fica **fora do PostgreSQL, mas ainda no sistema de arquivos descartável do mesmo runner**; não houve entrega a storage remoto, armazenamento durável independente, assinatura externa, replicação, versionamento, verificação após queda de energia real ou testes de falha de rede.
- A chave é estática e sintética, visível no workflow; não serve para produção. Exigidos KMS/chave sob controle do usuário, troca de chave e revogação, política de escrow e restrição de acesso.
- A amostra contém **64 eventos de uma TV**, distribuídos em dois segmentos de 32, para exercitar fronteiras e concorrência. Não demonstra recuperação de 7 dias, 100/300 TVs, grande arquivo, auditoria de múltiplas empresas em escala, autenticação JWT real ou limites de memória.
- O manifesto no PostgreSQL é um índice por segmento, mas confirmar o conteúdo de eventos antigos exige **ler, descriptografar e verificar o segmento completo**; custo de IO remoto, cache, limites de CPU, throttling e indisponibilidade precisam de testes em maior escala.
- O endpoint é um protótipo **somente de replay de comprovantes já confirmados**, sem misturar ingestão de novos eventos. Não contém a máquina de estados e o índice histórico de produção, nem solução de retenção/backup completo; não resolve cobrança/comprovantes sem relógio.
- Arquivamento local cria arquivo **antes** de confirmar manifesto. Se falhar após gravar arquivo, pode sobrar órfão; falta coleta segura de órfãos com prova de que não há manifesto referenciando o arquivo. Nenhum arquivo é removido automaticamente agora.
- Um token fictício e superusuário PostgreSQL são usados só para configurar banco descartável; o endpoint adota um papel SQL sem acesso às provas originais, mas **não equivale a RLS/JWT reais** em Supabase.
- Erros de replay não devem ser interpretados como confirmação de reprodução. Não há DELETE, VACUUM, TTL ou job de retenção.

## Próximo gate

1. Protocolo documental e teste de **persistência independente em storage remoto de QA** com restauração verificada, commit de manifesto, proteção contra órfãos e chaves não expostas.
2. Benchmark da latência/custo de descriptografar segmentos grandes, concorrência e 7/12/20/50/100 TVs. Evitar pressão excessiva em HTTP e Supabase.
3. Desenho de índice mínimo de manifestos por stream para replay sem ledger por evento; testar colisões de stream, ordenação, concorrência de gravação, troca de TV e rollback sem false ACK.
4. Somente depois de comprovar replay sem origem, backup externo/restauração e reenvios idempotentes, **propor**, não executar, política de retenção com aprovação específica. Não mexer em originais reais.

**Decisão:** **18 PASS isolados; NO-GO para migração, exclusão, publicação ou TVs reais.**
