# Vision V2 — armazenamento externo simulado independente, prova durável e replay (31/10/2026)

**Resultado final: 17 PASS / 0 FAIL / 0 ERROR**, em PostgreSQL 17 descartável e servidor HTTP de objetos em **contêiner Docker separado**, com diretório montado separado. **NO-GO para produção, retenção com DELETE ou TV.**

## Evidência exata

- Branch isolada: `experiment/vision-v2-sequence-watermark-qa-20261031`.
- GitHub Actions final: [run 41238669316](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41238669316), commit testado `9bdd09aa3f6cb4794f064243edfbb518d143d03c`, conclusão `success`.
- Logs: `EPHEMERAL_QA_KEYS_GENERATED=PASS; values never logged`, `ISOLATED_DOCKER_STORE_READY=true`, `V2_REMOTE_ORPHAN_RECOVERY_PASS stored_without_manifest_then_revalidated=true`, `V2_REMOTE_OFFLINE_RECOVERY_PASS no_new_ack=true`, `V2_REMOTE_CONTAINER_RESTART_PASS volume_persisted=true`, `V2_REMOTE_DURABLE_RESTORE_PASS store=separate_docker readback_sha256=true restored=32`, `V2_REMOTE_CONCURRENCY_PASS workers=8 replays=256 new_ack=0`, `Ran 17 tests in 13.019s`, `OK`, `REMOTE_STORAGE_CRYPTO_AND_REPLAY=PASS`.
- Histórico de falha anterior: [run 41238568737](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41238568737), 16 PASS + 1 ERROR de sintaxe PostgreSQL no **próprio teste de injeção** de falha de manifesto. Corrigida somente a string SQL para corpo de função PL/pgSQL válido; reexecução final passou, sem mudanças no app.

## Código da entrega, somente de homologação

- [object_store.py](../../tests/vision-v2-sequence-qa/remote-store-qa/object_store.py): servidor HTTP em Docker Python separado, com volume de dados distinto, `PUT/GET` autenticados por token fictício, objeto imutável, escrita em arquivo temporário, `fsync` do arquivo e diretório, rename atômico e recibo HMAC-SHA256 de nome/hash/tamanho.
- [remote_protocol.py](../../tests/vision-v2-sequence-qa/remote-store-qa/remote_protocol.py): cliente; criptografa segmento AES-256-GCM, verifica assinatura do recibo durável, baixa arquivo para conferir SHA-256/cifra/conteúdo/identidade/eventos e **só depois** registra manifesto no PostgreSQL. Se objeto já existir após resposta perdida, verifica o conteúdo preexistente e recupera o órfão sem sobrescrever.
- [test_remote_protocol.py](../../tests/vision-v2-sequence-qa/remote-store-qa/test_remote_protocol.py): 17 casos de falha, reinício físico do contêiner, restauração isolada e replay concorrente.
- [workflow](../../.github/workflows/vision-v2-external-storage-qa.yml): PostgreSQL 17 em service container, armazenamento em outro Docker container, Python 3.12 e bibliotecas QA com versões fixas. **Nenhuma etapa de deploy, chamada ao Supabase, instalação ou alteração de APK/TV.**

## Protocolo comprovado

1. Servidor de objetos recebe arquivo cifrado via HTTP em loopback, faz `fsync` e `rename`, assina o recibo HMAC com chave sintética de teste.
2. Cliente verifica nome, SHA-256, bytes, atributo de durabilidade e HMAC do recibo; baixa novamente os bytes por HTTP e verifica SHA-256, AES-256-GCM, AAD do stream, hash do conteúdo e igualdade dos hashes dos eventos.
3. O manifesto PostgreSQL guarda **um registro por segmento** com identidade, intervalo, contagem, hash do arquivo e hash do conteúdo, sem ledger permanente por evento. Só é gravado após recibo durável e leitura de volta. O arquivo completo fica fora do banco PostgreSQL.
4. Reenvio de sequência **já confirmada** consulta apenas manifesto e arquivo; role SQL restrita não pode ler `receipts` originais. A resposta retorna apenas o watermark já existente, sem alterar ACK nem faturar recibos sem horário.
5. Se a resposta de upload for perdida depois de armazenamento durável, fica um arquivo órfão **sem manifesto**. Uma nova tentativa compara conteúdo completo do objeto existente com os comprovantes originais (que ainda estão preservados durante a homologação) e cria manifesto somente se coincidir.
6. Se arquivo ficar indisponível/corrompido, leitura remota falhar, chave estiver incorreta, recibo HMAC inválido ou manifesto não puder ser gravado, **falhar fechado sem emitir novo ACK**. A volta do serviço permite nova verificação.
7. Os tokens de armazenamento, administração, assinatura de recibos e chave AES foram **gerados aleatoriamente em cada job**, mascarados e usados apenas no runner descartável. A chave real de produção **não foi criada nem utilizada**.

## Resultado PASS/FAIL por comportamento

| Cenário | Resultado |
|---|---|
| Exportação remota e verificação por download | PASS |
| Restauração do segmento em SQLite novo, integridade `ok` | PASS |
| Falha de upload por ENOSPC injetado | PASS |
| Armazenamento respondendo indisponível antes de publicar manifesto | PASS |
| Resposta perdida após gravar arquivo; recuperação do órfão | PASS |
| Recibo durável HMAC fraudado → rejeitado | PASS |
| Serviço indisponível após arquivar → sem ACK; recuperação após retorno | PASS |
| Resposta GET adulterada (sem corromper disco real) → rejeitada | PASS |
| Chave AES errada → replay recusado | PASS |
| Lote misto falha quando arquivo/validade de segmento impede verificação | PASS |
| Oito threads, 256 reenvios validados, 0 ACK novo | PASS |
| Erro no commit do manifesto deixa órfão, originais intactos | PASS |
| Reenvio de sequência futura não confirmada → rejeitado | PASS |
| Payload diferente para sequência antiga → rejeitado | PASS |
| Token de outro dispositivo → rejeitado | PASS |
| Reinício real do contêiner com o mesmo volume → arquivo preservado | PASS |
| Serviço sem API de DELETE; originais não excluídos | PASS |

**Atenção:** no laboratório foram criados **64 comprovantes sintéticos por teste**, arquivados em segmentos de 32. O teste de restore confere 32 entradas. Esses números não demonstram capacidade comercial de 7 dias, 100 TVs, armazenamento infinito ou disponibilidade remota.

## Limitações que impedem autorização de produção

- O "externo" é **simulado**: segundo contêiner e volume independente do processo do PostgreSQL, mas ambos no mesmo runner GitHub; o volume é descartado ao final. **Não há durabilidade independente de região, provedor ou máquina**, nem TLS, S3, MinIO remoto ou Google Cloud.
- `fsync` e reinício de contêiner são evidências importantes, mas **não equivalem a corte de energia física** nem falha de hardware. Modos de rede e disco cheio são falhas simuladas por HTTP/erro de escrita, não particionamento real de rede nem esgotamento de eMMC.
- A credencial é temporária, mascarada e fictícia; em produção seriam necessários KMS, rotação, autenticação forte, TLS, controle de acesso separado entre gravação e leitura, object lock, políticas de backup e recuperação de chaves.
- Os originais **nunca foram excluídos**; a role HTTP não tem acesso a eles, mas o exportador utiliza os originais para criar/reconciliar segmento órfão. Após DELETE real, o procedimento de recuperação de órfão teria de usar manifesto externo assinado e cópias independentes. **NÃO AUTORIZA DELETE.**
- O protocolo não automatiza limpeza segura de órfãos. Se um upload ocorrer e o manifesto não for gravado, o arquivo pode ficar ocupando espaço até reconciliação.
- Não há previsão de faturamento, API/JWT/RLS reais, cache de arquivos para 100/300 TVs, cotas do servidor, latência pública, custos mensais, replay após décadas, travamento do player, migração de schema ou integração ao APK.
- O resultado não muda a necessidade de armazenar e demonstrar comprovantes sem hora em quarentena com `billable=false` até prova temporal legítima.

## Decisão

**PASS** apenas do protocolo de gravação durável simulada, confirmação verificável, restauração, recuperação de órfãos e reenvios idempotentes de arquivos por HTTP local. **NO-GO** para API real, backup externo persistente, cron de arquivamento, DELETE/TTL, Supabase, deploy ou TVs.

**Próxima validação recomendada:** especificar e testar uma transferência para um **provedor/serviço QA remoto de verdade**, com TLS, autenticação e KMS de teste, incluindo indisponibilidade remota e restauração em outro runner; só depois desenvolver a política de retenção com segurança por stream. Essa fase exige autorização específica e não está sendo executada.
