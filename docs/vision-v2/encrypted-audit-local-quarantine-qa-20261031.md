# Vision V2 — Exportação criptografada da auditoria + quarentena local SQL/HTTP (31/10/2026)

**Estado: PASS de testes isolados, NO-GO para produção.** Branch `experiment/vision-v2-sequence-watermark-qa-20261031`. Não houve alterações no Supabase da Vision, main, APK, player, painel, site ou TVs. Todos os dados são fictícios.

## Evidências reais

- [GitHub Actions — execução final 41234086659](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41234086659), commit de código testado `ae5004286a1c51d208ced34ea0bb165bb876f4f7`: **24 PASS, 0 FAIL, 0 ERROR**.
- **13 testes** Python + SQLite + criptografia AES-256-GCM: cópia consistente do banco via `sqlite3.backup()`, cifra/decifra, hashes SHA-256, restauração em banco independente, senha incorreta, adulteração, truncamento, ENOSPC injetado, interrupção antes da troca atômica de arquivo, recusa sobrescrita e ACK original inalterado.
- **11 testes** PostgreSQL 17 real descartável + HTTP no loopback 127.0.0.1: token, empresa, stream, isolamento entre duas empresas fictícias, reenvio idempotente, lacuna, alteração indevida do mesmo evento, limite 1–50, rejeição de data do cliente, seis envios simultâneos e falha de gravação com rollback integral.
- [Execução anterior 41234002073](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41234002073): **23 PASS**, antes da inclusão do teste de capacidade máxima.

Trechos literais do log final:

```text
Ran 13 tests in 0.950s
OK
PASS_LARGE_AUDIT_RESTORE encrypted_bytes=1883731 proofs=4096 reviews=8192 source_ack=9
AUDIT_AES256_GCM_EXPORT_RESTORE=PASS
LOCAL_POSTGRES_SCHEMA_PASS=vision_v2_quarantine_disposable
Ran 11 tests in 0.882s
OK
HTTP_QUARANTINE_CONCURRENCY_PASS six_writers=2_unique
HTTP_QUARANTINE_ACK_PASS ack=2 nonbillable=2
HTTP_QUARANTINE_ROLLBACK_PASS ack_unchanged=0
HTTP_POSTGRES_QUARANTINE=PASS
NO_DEPLOY=true NO_SECRETS=true NO_PRODUCTION_TRAFFIC=true
```

## Arquivos da entrega (somente QA)

- [audit_backup.py](../../tests/vision-v2-sequence-qa/audit-export-qa/audit_backup.py): exporta somente as tabelas de auditoria via snapshot SQLite read-only; criptografa com AES-256-GCM; derivação da chave via scrypt com sal aleatório, nonce aleatório, hashes SHA-256 das tabelas; escrita temporária + fsync + rename.
- [test_audit_backup.py](../../tests/vision-v2-sequence-qa/audit-export-qa/test_audit_backup.py): 13 testes incluindo volume máximo de auditoria.
- [schema.sql](../../tests/vision-v2-sequence-qa/quarantine-qa/schema.sql): esquema PostgreSQL privado com guarda de nome de banco descartável; isolamento company/device/stream; recibos sem `event_played_at` e `billable=false`.
- [server.py](../../tests/vision-v2-sequence-qa/quarantine-qa/server.py): HTTP local com token SHA-256, `SELECT ... FOR UPDATE`, sequência contínua e ACK somente depois do commit de todas as linhas.
- [test_http_quarantine.py](../../tests/vision-v2-sequence-qa/quarantine-qa/test_http_quarantine.py): 11 casos de segurança, atomicidade e reenvio.
- [workflow](../../.github/workflows/vision-v2-audit-quarantine-qa.yml): GitHub Actions sem secrets de produção, sem deploy; PostgreSQL 17 em service container descartável; Python 3.12 e dependências QA com versões fixas.

## O que a restauração criptografada realmente protege

Cópia consistente das provas/revisões, sem `UPDATE` ou `DELETE` no banco original. O material criptografado é autenticado com AES-256-GCM, contém hashes de integridade dos registros e exige senha. Na restauração, a integridade e as contagens são verificadas; a ferramenta **cria outro banco somente de auditoria**, nunca sobrescreve o banco do player.

**Medição real máxima:** 4.096 provas + 8.192 revisões = **1.883.731 bytes** (aproximadamente 1,88 MB decimais) em arquivo criptografado, na carga fictícia testada. A exportação preservou o ACK local original (9 na fixture), sem modificar registros.

**Limites importantes:**
- Este backup **não contém** a fila integral de playback, mídias, SQLite WAL/SHM, configurações Android, assinatura do APK ou as tabelas do Supabase. **NÃO é backup de desastre completo da Vision.**
- Falha de disco foi simulada como `OSError(ENOSPC)`, e perda de energia como exceção antes do rename; não houve corte elétrico real ou falha física em eMMC.
- Ainda não existe chave final gerida pelo usuário, rotação/escrow, armazenamento remoto privado, cópias redundantes, política de retenção, confirmação de recebimento externo, auditoria independente, exportação incremental, assinatura institucional ou rotina de restauração em aparelho Android.
- **Sem exclusão após backup.** A exportação não libera espaço da auditoria; qualquer compactação futura depende de entrega externa verificada e autorização expressa.

## Contrato de quarentena local implementado e validado

Requisição QA:

```text
POST http://127.0.0.1:<porta-efemera>/qa/quarantine
x-device-token: <token-de-teste>
{
  "device_id":"device-A",
  "stream_id":"stream-A",
  "events":[{
    "sequence":1,"event_id":"proof-00000001",
    "media_id":"ad-A","boot_id":"boot-qa-0001",
    "mono_ms":15000,"seconds":15,"completed":true
  }]
}
```

**Não incluir `played_at` ou data inventada.** O banco registra `received_at` como instante do **recebimento no servidor**, que NÃO substitui o horário da exibição, e mantém `event_played_at=NULL`, `status=PENDING_TIME`, `billable=false`.

**Resposta depois do commit:** `{"ack":1,"accepted":1,"duplicates":0,"quarantined":1,"billable":0}`. O servidor controla o stream e tenant a partir da credencial, não do corpo do cliente; linha do device é bloqueada por `FOR UPDATE`; atualiza o watermark somente na mesma transação que insere todos os comprovantes. Duplicatas devem corresponder ao hash do conteúdo original; lacunas, alteração de identidade, token errado e lote inválido são recusados. Nenhuma falha de banco emite ACK.

**Não equivale a estar pronto para o app:**
- Este protótipo tem credenciais fictícias, nenhum JWT real, HTTPS/TLS, gerenciamento de credenciais, rate limiting, auth do painel Master, prevenção de abuso ou RLS validada sob papéis reais. No laboratório a conexão PostgreSQL usa um superusuário sintético e o escopo de segurança está na lógica HTTP testada.
- O recibo em quarentena é guardado **por evento**, portanto o armazenamento no servidor continua crescendo. Antes de tráfego real, definir quota, exportação/arquivo auditável, custo de I/O, tamanho de índices e modelo de retenção com garantia contra reenvios antigos.
- ACK em quarentena = recebimento durável do registro sem horário; **NÃO = reprodução datada, comprovada ou faturável**.
- Não foi testado um fluxo misto real do Android que alterne comprovantes sem hora e datados. É necessário desenvolver um contrato comum de sequência, autenticação e categorias de recibo. Não liberar segmento do celular/TV antes de ACK autenticado do mesmo stream.
- Sem fonte temporal confiável para um boot antigo, **a data daquela exibição continua desconhecida**. Uma revisão manual pode classificar a prova, jamais inventar um instante nem mover valores para relatório comercial.
- Não foi realizado teste de 100/300 TVs, carga prolongada, armazenamento em cloud, recuperação após crash físico do PostgreSQL, backup externo de todo o banco ou implantação no Supabase V2.

## Próximo gate recomendado

1. **Protocolo de entrega externa confirmado** para backup criptografado (hash, destino privado, confirmação durável, restauração real em sandbox), sem remoção automática de originais.
2. **Contrato único de eventos datados + quarentenados** integrado com SQLite segmentado em QA, JWT/token e anti-replay reais, com métricas de P95, I/O, WAL PostgreSQL e bytes por 1 milhão de eventos.
3. Teste de volume de quarentena e retenção por stream, garantindo que o backend não repita o crescimento ilimitado da V1.
4. Homologação Android/TV Casa apenas com aprovação específica; nenhuma TV de cliente ou APK existente deve ser substituído.

**Decisão: PASS no laboratório criptográfico e no HTTP/Postgres descartável; NO-GO para migração, site oficial, Supabase e equipamentos.**
