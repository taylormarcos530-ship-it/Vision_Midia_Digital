# Vision V2 — SQLite fault injection, recuperação e reboot sem horário (31/10/2026)

**Resultado: 34 PASS, 0 FAIL, 0 erros, 0 ignorados (execução final).** QA isolado; **NÃO CONECTAR TV NEM PUBLICAR**.

## Escopo e controle de segurança
- Branch: `experiment/vision-v2-sequence-watermark-qa-20261031`.
- Somente novo arquivo de testes: `tests/vision-v2-sequence-qa/android-sqlite-qa/src/test/java/br/com/visionmidia/v2qa/SequenceStoreFailureTest.java`.
- Código Android de QA existente `SequenceStore.java` **não foi modificado**, nem `player.js`, `android-player/`, `main` ou APK.
- Workflow existente [vision-v2-android-sqlite-qa.yml](../../.github/workflows/vision-v2-android-sqlite-qa.yml) roda testes unitários da biblioteca Android em JVM Linux, com Robolectric em modo SQLite **NATIVE**, sem compilar/distribuir APK, sem segredos e sem Supabase.
- Um segundo workflow de testes Node da branch experimental foi executado e não substitui a evidência dos testes Android.

## Evidência real de GitHub Actions
- **PASS FINAL:** [run 41223321869](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41223321869) no commit `0ec0bf303dc16f11db41e982771c6ab80e940c1b`.
- Log: `NO_APK=true NO_INSTALL=true NO_DEPLOY=true NO_SUPABASE=true NO_SECRETS=true`.
- Log: `BUILD SUCCESSFUL in 53s`; `ANDROID_SQLITE_ROBOLECTRIC=PASS`.
- XML da classe nova: `SequenceStoreFailureTest tests="15" skipped="0" failures="0" errors="0"`.
- XML da classe anterior: `SequenceStoreTest tests="19" skipped="0" failures="0" errors="0"`.
- **Falha anterior documentada, não escondida:** [run 41223210604](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41223210604), 34 testes, **33 PASS e 1 FAIL**. O teste de estado propositalmente corrompido tentava consultar `snapshot()`, método que deve recusar dados inconsistentes. Corrigido **somente no teste**: a integridade continua falhando de forma segura, e o contador é inspecionado diretamente por SELECT SQL para confirmar que não foi reiniciado. Nenhuma proteção foi afrouxada.

## Casos exercitados nos novos 15 testes
1. Erro SQL injetado `BEFORE INSERT`: não grava evento nem incrementa sequência.
2. Erro SQL injetado `BEFORE UPDATE OF next_seq` após INSERT: transação reverte ambos.
3. Exceção simulando queda **antes do commit** após já existir comprovante: evento antigo preservado e número reutilizado para retry.
4. Reinício do processo **depois de um commit bem-sucedido**, com retorno perdido para o chamador: mesmo event ID pendente recuperado, sem gerar sequência nova.
5. Erro SQL no contador de ACK **depois de DELETE**: exclusão e confirmação revertidas; comprovantes intactos.
6. O envio incerto permite repetir o mesmo lote sem perder evento.
7. Erro durante UPDATE do horário de comprovante: transação reverte tanto âncora quanto timestamps retroativos.
8. Recuperação após encerrar/reabrir SQLite no **mesmo boot**, usando intervalo monotônico e hora autenticada.
9. Novo boot com evento antigo sem âncora: não inventa data, preserva evento e **bloqueia FIFO**.
10. Múltiplos reboots não substituem a informação do comprovante sem data.
11. Evento anterior com data confiável pode ser enviado depois de reboot quando conectado.
12. Data 1970 no segundo boot é rejeitada, comprovante original preservado.
13. Erro SQL ao provisionar novo stream não deixa identidade parcial.
14. Estado SQLite corrompido não é reiniciado automaticamente.
15. Offline e relógio não confiável não atualizam `sent_through` ou `confirmed`.

Além disso, 19 testes de base regressivos passaram para limites, relógio 1970, fuso America/Sao_Paulo, monotonicidade Android, ACK, fila e consistência.

## Limitações: testes não são equivalentes a dispositivo real
- Falhas de armazenamento foram produzidas com gatilhos SQL `RAISE(ABORT,...)` do **SQLite nativo**, não com volume fisicamente cheio, IOException/SQLiteFullException genuína, deterioração de flash ou corrupção após energia cortada.
- A queda antes do commit é **exceção injetada**, não desligamento elétrico no instante preciso. O caso pós-commit é reinicialização do objeto/SQLite; não é corte elétrico brusco.
- O SQLite persiste apenas o registro local QA. **Não prova que um APK preserva e envia eventos no aparelho real**.
- A hora autenticada e ACK ainda são sinalizados por `boolean` de QA; não há autenticação real, boot ID nativo validado, nem isolamento multiempresa em endpoints.
- Um registro de um boot anterior sem âncora não tem hora real verificável. **Não existe recuperação automática segura da data** apenas com o relógio do boot seguinte. O sistema mantém o comprovante local e bloqueia seu envio até protocolo de conciliação supervisionada. Isso é um impeditivo de GO, não uma funcionalidade concluída.
- Uma fila com 2.000 pendências interrompe novas gravações; ainda faltam dimensionamento offline, alertas, backup, limites de disco, tombstones de event IDs já confirmados e política de auditoria comercial.
- Não há estudo atual do custo de CPU, WAL, índices e espaço no Supabase com este módulo; este teste não certifica 100/300 TVs.

## Próximo gate
Antes de pensar em homologação na TV Casa:
1. Testes de **SQLiteFullException genuína** com quota/banco descartável, `PRAGMA integrity_check`, recuperação após fechamento, `WAL` e limpeza das transações, e limites de gravação.
2. Construir o protocolo de auditoria manual de comprovantes sem horário, mantendo prova original e aprovação da conciliação em banco isolado.
3. Autenticação/ACK com token e stream validado em API QA; preservar isolamento entre empresas.
4. Simular ciclo offline prolongado acima do limite de 2.000 eventos e prever alerta sem fabricar comprovantes.
5. Teste Android real em TV Box de bancada exigirá **aprovação específica**, sem mexer no APK nem em TVs de clientes até então.

**Sem alteração em Supabase, Vercel, painel, site, APK, histórico real ou TVs.**
