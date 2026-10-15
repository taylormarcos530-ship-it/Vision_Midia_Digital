# Vision Mídia Digital — Checkpoint: encerramento do processo durante as fases do commit

**Checkpoint de origem preservado:** `4e6c4e97cf4ea26eafba393bbfc6e8ea0ce59a5c`  
**Branch isolada:** `fix/advertiser-portal-safety-20261013`  
**Escopo exclusivo:** laboratório offline de custódia de evidências sintéticas. Sem alteração em produção, player, gateway, APK, playlists, serviços remotos, banco, Storage, dispositivo, SQL ou campanhas de clientes.

## Homologação de código

- Execução inicial: **610/610 PASS, 0 falhas**, proteção dos arquivos operacionais **PASS**: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38796503404
- Execução completa com relatório CLI: **613/613 PASS, 0 falhas**, proteção dos arquivos operacionais **PASS**: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38796714039
- **17 testes novos nesta rodada**: 14 sobre encerramento do processo e fases de escrita, três do relatório local. Todos os **596 testes anteriores** continuam verdes.
- Somente arquivos novos em `tests/` e esta documentação; o módulo original `tests/fixtures/commercial-evidence-durable-lab.cjs` e o revisor anterior não foram modificados.

## Implementação

- `tests/tools/commercial-evidence-crash-worker.cjs`: executado como subprocesso Node real. Reproduz **o mesmo formato persistente de laboratório** (recibo + identidade idempotente e checksum), adquire `writer.lock`, grava marcador de proprietário e encerra intencionalmente com `process.exit(77)` em um de quatro pontos: `AFTER_LOCK`, `AFTER_TEMP_SYNC`, `AFTER_RENAME`, `AFTER_DIR_SYNC`. Não executa um deploy, não conecta conta externa e **não roda no player**.
- `tests/commercial-evidence-process-crash-recovery.test.cjs`: 14 testes que lançam o subprocesso, conferem sua saída, reabrem o ledger real dentro do diretório temporário e submetem a recuperação de lock à revisão dupla **simulada**. Cobrem tanto a primeira emissão de recibo quanto a rotação do segundo recibo.
- `tests/tools/commercial-evidence-crash-recovery-report.cjs`: comando local de exemplo, com um encerramento após `rename`, recuperação revisada e retry idempotente. A pasta temporária é destruída ao final do processo.
- `tests/commercial-evidence-crash-recovery-cli.test.cjs`: três testes verificam saída redigida, inércia de caminhos externos e ausência de hash completo, token, ID de requisição e caminho privado.

## Resultado por fase

| Momento da saída do subprocesso | Estado do ledger ao reiniciar | Arquivos abandonados | Conduta verificada |
|---|---|---|---|
| `AFTER_LOCK` — apenas lock e marcador do proprietário | Recibo anterior permanece, ou vazio quando primeira gravação | `writer.lock` | Bloquear nova escrita; revisão de proprietário encerrado e cabeça pinada; tentar novamente |
| `AFTER_TEMP_SYNC` — temporário gravado/sincronizado, antes do `rename` | Recibo anterior permanece, ou vazio | `writer.lock` e `*.tmp` | **Não adotar nem limpar automaticamente** temporário; conferir ledger e cabeça, revisar lock e executar novo commit |
| `AFTER_RENAME` — nome definitivo já substituído, antes do sync do diretório | Recibo novo pode ser lido no teste Node | `writer.lock` | Revisão com digest **novo**; reenvio do mesmo ID retorna `ALREADY_COMMITTED` |
| `AFTER_DIR_SYNC` — após sincronizar diretório, antes da resposta | Recibo novo pode ser lido no teste Node | `writer.lock` | Mesma recuperação; **sem duplicar** recibo nem chave de idempotência |

Em todos os casos, o lock órfão **continua ativo até a revisão simulada**. Registro corrompido, cabeça independente fornecida divergente, ausência da dupla confirmação ou marcador inválido **impedem liberação**. Uma tentativa com a cabeça antiga de histórico já avançado resulta em `CONFLICT_STALE_HEAD`. Reutilizar o ID de uma requisição para recibo diferente gera `IDEMPOTENCY_CONFLICT`.

**Ponto relevante:** um temporário abandonado não vira automaticamente registro persistido: apenas `ledger.json` validado integra o estado de commit. A remoção de temporários rejeitados não foi automatizada e deverá ser especificada com quarentena/revisão antes de uso real.

## Limitações expressas

1. O subprocesso usa `process.exit(77)` **após** chegar a uma fase determinada. É encerramento intencional no runner; **não** representa desligamento elétrico, queda do kernel, I/O parcialmente concluído, fsync defeituoso, NFS ou escrita distribuída.
2. O worker reproduz separadamente o protocolo de disco do guardião de teste, para deixar lock/temporário abandonados ao encerrar; não altera o método `publish` original nem comprova o mesmo comportamento sob todo tipo de falha no método oficial.
3. `rename` seguido de saída sem `fsync` do diretório é legível neste ensaio, mas **não estabelece durabilidade após perda real de energia**; essa é uma das razões para testar separadamente `AFTER_RENAME` e `AFTER_DIR_SYNC`.
4. `owner.json` e o pin SHA-256 são **fictícios e não autenticados**. PID pode ser reutilizado; dois campos booleanos não são assinaturas verificadas de revisores. Não reutilizar o código de recuperação em serviço real.
5. O checksum sem chave é teste de integridade acidental, não proteção contra um agente que controla os dados e o hash de referência. A persistência não é um armazenamento append-only auditado nem um guardião externo.
6. O teste **não** aprova staging, restauração de cliente, migração, novas Edge Functions, anúncios comerciais ativos ou deploy. O módulo retorna proibições explícitas de liberação operacional.

## Reprodução isolada

```bash
node tests/tools/commercial-evidence-crash-recovery-report.cjs
npm test
```

Ambos funcionam apenas com fixtures locais e criam recursos descartáveis sob `os.tmpdir()`. Não apontar a testes ou relatórios de clientes.

## Portal comercial — bloqueios mantidos

**Nenhum dos 17 critérios de staging real foi homologado.** `SQL-01` e `SQL-02` continuam **BLOCKED**: o SQL revisável `supabase/sql/advertiser-portal.sql` ainda contém privilégios amplos para as revisões e projeção `to_jsonb(r)` que podem expor metadados internos `source_*`. A alternativa está unicamente na fixture de PostgreSQL descartável `tests/fixtures/commercial-safe-projection-lab.sql`. Nenhuma migration foi aplicada.

**Próxima etapa segura:** projetar e testar a inspeção/quarentena **somente local** de arquivos `*.tmp` abandonados após encerramento, garantindo que um temporário não seja confundido com um commit e que um arquivo inesperado, symlink ou caminho fora do namespace não seja removido. Manter as restrições de não conectar produção e não modificar nada operacional.
