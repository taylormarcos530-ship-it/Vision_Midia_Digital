# Vision V2 — SQLite FULL, integridade, fila 2.000 e auditoria offline (31/10/2026)

**Resultado final: PASS 47/47, FAIL 0, skipped 0, errors 0.** Esta etapa executou somente testes **Android Robolectric JVM + SQLite NATIVE** em runner descartável do GitHub Actions, sem acesso ao PostgreSQL/Supabase. **Não usar em produção / não instalar APK.**

## Evidências verificadas
- Branch: `experiment/vision-v2-sequence-watermark-qa-20261031`.
- [Execução final GitHub Actions 41224864747](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41224864747), no commit `f9a99cebb023896350ef1cc162b71dde62aed481`. Job `sqlite-android-qa`.
- No log: `NO_APK=true NO_INSTALL=true NO_DEPLOY=true NO_SUPABASE=true NO_SECRETS=true`.
- No log: `QA_SQLITE_FULL_CLASS=android.database.sqlite.SQLiteFullException`.
- No log: `QA_SQLITE_FULL_MESSAGE=database or disk is full (code 13 SQLITE_FULL)`; `QA_NATIVE_SQLITE_FULL_CONFIRMED=true`; `QA_ANDROID_SQLITEFULL_SUBCLASS_OBSERVED=true`.
- No log: `BUILD SUCCESSFUL in 52s` e `ANDROID_SQLITE_ROBOLECTRIC=PASS`.
- XML de testes: `SequenceStoreCapacityTest` 5 testes, zero falhas; `SequenceStoreFailureTest` 15; `UnresolvedAuditQueueTest` 8; `SequenceStoreTest` 19; total **47** sem falhas/erros/ignorados.
- Regressões Node de sequência e relógio também passaram, mas não são contadas entre esses 47 testes Android.

## O que foi alterado
- **Somente na pasta experimental de QA** `tests/vision-v2-sequence-qa/android-sqlite-qa/`:
  1. `SequenceStoreCapacityTest.java`: teste SQL real `PRAGMA max_page_count` para produzir SQLITE_FULL com classe real `SQLiteFullException`, preservação de estado após reabertura, `PRAGMA integrity_check`, limite de 2.000 eventos e recusa sem relógio.
  2. `UnresolvedAuditQueue.java`: comprovante original separado, SHA-256 verificável das propriedades imutáveis, journal de revisão somente append, bloqueio de UPDATE/DELETE nas tabelas de auditoria, sem criação de data artificial, sem enviar eventos ou confirmar ACK.
  3. `UnresolvedAuditQueueTest.java`: 8 testes de preservação, staging idempotente, reinícios, revisão, tentativa de alterar histórico, evidência autenticada simulada, corrupção e rollback da auditoria.
  4. `SequenceStore.java`: correção mínima no tratamento de encerramento de transações. Se uma falha SQLite provoca rollback automático e o `endTransaction()` produz `cannot rollback - no transaction is active`, o código mantém a **exceção original**, anexando a de encerramento como suprimida. Não altera o protocolo/playlist ou player em uso.
  5. `build.gradle`: exibição detalhada das falhas e mensagens nos logs de QA.
- `player.js`, `android-player/`, `main`, Supabase V1/V2, APK, site, painel, mídias e TVs não foram alterados por esta etapa.

## Histórico PASS/FAIL — não ocultar falhas anteriores
- [Run 41224329779](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41224329779): FAIL 1/39, classe mascarada no teste de espaço.
- [Run 41224378367](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41224378367): FAIL 1/39.
- [Run 41224412229](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41224412229): FAIL 1/47; os 8 novos de auditoria PASS.
- [Run 41224543116](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41224543116): FAIL 1/47; o erro ainda não podia ser identificado pela mensagem curta.
- [Run 41224692991](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41224692991): FAIL 1/47; log completo mostrou `cannot rollback - no transaction is active (code 1 SQLITE_ERROR)`, que escondia a causa raiz.
- **[Run 41224864747](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41224864747): PASS 47/47** após a correção de preservação da exceção; demonstrou `SQLiteFullException` genuína e `SQLITE_FULL code 13` sob quota de páginas real do banco local.

## Interpretação técnica
- `PRAGMA max_page_count` cria uma condição real de **esgotamento de páginas SQLite**, fazendo a engine gerar `SQLITE_FULL`, não uma exceção Java inventada. **Não simula memória flash fisicamente cheia**, desgaste de storage, energia cortada, egress ou disco do Supabase.
- Após falha de escrita, a transação não pode deixar meio evento nem incrementar sequências sem preservar o registro. Os testes avaliam reabertura, tamanho da fila, próximo contador e integridade. `PRAGMA integrity_check` atesta integridade física SQLite, mas **não substitui** a validação lógica dos números de sequência.
- O limite 2.000 é **NO-GO para indisponibilidade prolongada**: com reprodução a cada 15 s, enche em aproximadamente **8 h 20 min**. Uma semana contínua gera **40.320 eventos por TV**, muito mais que 2.000. A fila recusa novos comprovantes em vez de sobrescrever antigos, mas isso não equivale a histórico completo ou comprovação comercial confiável sob falha longa.
- No fluxo auditável, o original sem data é guardado com hash e journal local. Marcar como `PREVIOUS_BOOT_UNVERIFIABLE` não inventa data, não remove original e **não libera ACK/upload**. Hora de boot anterior sem âncora confiável não pode ser reconstruída do relógio do boot seguinte.
- Quando a API de QA dá uma âncora autenticada **no mesmo boot**, o código de base pode reconstruir o timestamp a partir de `elapsedRealtime` e registrar evidência; no experimento um `boolean authenticatedProof` apenas **simula** esta validação — ainda falta autenticação real com backend, anti-replay e isolamento multiempresa.
- Os triggers de imutabilidade defendem a aplicação contra UPDATE/DELETE comum; não são proteção criptográfica contra DBA com acesso privilegiado ou destruição do banco. Sem backup/transferência externa do log, ainda não há auditoria independente.
- Testes em Robolectric não certificam modelo de TV Box real, fsync em eMMC, travamento pelo WebView, interrupção física de energia ou disponibilidade de horas com clock 1970.

## Próximas exigências antes de GO
1. Projeto de fila SQLite **durável e dimensionada para vários dias offline**: segmentação, reserva mínima de armazenamento, alertas de quase cheio e retenção com backup comprovado; não apagar evidências de anúncios.
2. Protocolo de reconciliação para stream com comprovantes antigos sem horário, sem bloqueio infinito e sem inventar registros; recontagem comercial deve ser idempotente e auditável.
3. Integração real de autenticação/ACK e relatório multiempresa em ambiente QA, sem Supabase de produção.
4. Teste físico de armazenamento cheio/power-cycle somente em TV de bancada com autorização posterior; não publicar APK ou alterar equipamentos existentes.
5. Medição de crescimento WAL, índice, latência, consumo HTTP/Edge e volume de Storage em cenários de 7, 12, 20, 50, 100+ TVs; manter folga de capacidade.

**Decisão: PASS de engenharia isolada; NO-GO para TVs ou sistema oficial.**
