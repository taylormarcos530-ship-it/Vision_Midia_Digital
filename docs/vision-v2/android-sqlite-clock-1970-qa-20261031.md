# Vision V2 — Android/SQLite offline + relógio 1970 (31/10/2026)

**Estado da etapa: PASS dos testes unitários Android com SQLite nativo no Robolectric. NO-GO para APK/TV real.**

- Branch: `experiment/vision-v2-sequence-watermark-qa-20261031`, isolada; arquivos **novos** em `tests/vision-v2-sequence-qa/android-sqlite-qa/`.
- GitHub Actions: [execução 41222839454](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41222839454), commit `d7300a69fac4fb5044780aa03bc62758ce50cfd0`.
- Log original: `BUILD SUCCESSFUL in 51s` e XML `tests="19" skipped="0" failures="0" errors="0"`, duração dos testes `8.513s`.
- **Duas tentativas anteriores falharam na configuração do Android SDK (antes dos testes):** [41222734921](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41222734921) (`setup-android` solicitou pacote `tools` inexistente) e [41222795602](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41222795602) (caminho fixo do `sdkmanager` não encontrado). O workflow final localiza as ferramentas instaladas no runner. **Esses dois jobs são FAIL de preparação de ambiente, não PASS.**
- Arquivos: [SequenceStore.java](../../tests/vision-v2-sequence-qa/android-sqlite-qa/src/main/java/br/com/visionmidia/v2qa/SequenceStore.java), [SequenceStoreTest.java](../../tests/vision-v2-sequence-qa/android-sqlite-qa/src/test/java/br/com/visionmidia/v2qa/SequenceStoreTest.java), [workflow](../../.github/workflows/vision-v2-android-sqlite-qa.yml).

## O que passou
- SQLiteOpenHelper e tabela `stream_state`: provisionamento somente explícito; falta de estado recusa operação; não reiniciar sequência automaticamente.
- Transação SQLite insere o evento e incrementa a sequência juntos; injeção de falha após `INSERT` prova rollback de ambas as mudanças.
- Fechamento e reabertura do banco recuperam os eventos e sequência; reenvio local do evento pendente não altera sua sequência.
- A fila é FIFO; sem rede o código não prepara lote nem marca eventos como enviados; somente ACK verificado elimina o prefixo efetivamente enviado.
- Resposta perdida após envio permite reenvio da **mesma sequência**, não de uma sequência nova; ACK fora do intervalo e não verificado são rejeitados.
- Relógio 1970: **não lê Date.now como verdade**. Usa amostra de monotonicidade `SystemClock.elapsedRealtime()` associada a um identificador de boot fornecido pelo componente nativo.
- Tempo externo só é aceito quando a camada chamadora sinaliza que ele foi autenticado; timestamp inválido/1970 rejeitado. Eventos do mesmo boot são corrigidos retroativamente, usando o delta monotônico.
- Dia local em `America/Sao_Paulo` corrigido na passagem de meia-noite; outro boot não herda âncora indevida; evento mais antigo sem hora comprovada bloqueia o lote e preserva os registros.
- Corrupção da sequência do banco exige reparo, não exclusão silenciosa.
- Event ID duplicado com payload diferente recusa a operação.

## Limitações / NO-GO
1. **Robolectric JVM não é uma TV Box física, um APK instalado, nem teste de power-cycle real.** Nenhuma compilação de app, assinatura, deploy, site ou acesso ao Supabase foi executado.
2. O protótipo usa um booleano de homologação para `verifiedAuthenticated`/ACK. Isso **não é autenticação real**. Deve haver contrato de confiança forte com API segura por stream/dispositivo, sem credencial de servidor embutida no APK.
3. O identificador de boot não é gerado/validado pelo protótipo; a integração nativa deve comprovar um ID único por reinício e monotonicidade. Sem isso, bloquear reconciliação temporal.
4. Se a TV desligar antes de sincronizar e voltar em outro boot, um comprovante antigo sem horário confiável permanece bloqueado até recuperação supervisionada. **Não inventar data, não apagar nem recontabilizar.**
5. Persistência sob corte físico de energia, desgaste, corrupção real, cota cheia de SQLite, `WAL`/`PRAGMA synchronous`, migração de schema e teste sob pressão de 100 TVs **ainda não foram homologados**.
6. A política de event IDs depois de ACK, restauração de backup, troca de TV/stream, relatórios comerciais auditáveis, gestão de fila cheia e sincronização real com Postgres requerem protocolo final.
7. A fila protótipo limita 2.000 eventos; quando cheia, **recusa gravação**. Isso não garante persistência ilimitada durante queda prolongada, mas evita descarte silencioso. Projetar armazenamento e alarme antes de produção.
8. O teste do Android/SQLite não prova consumo baixo de Edge, Storage, egress ou índices no Supabase. O banco principal original não foi alterado.

## Decisão de segurança
**PASS restrito ao Android/SQLite local simulado**. Próxima fase segura: testes do contrato de autenticação, reboot no Android real apenas em aparelho de homologação depois de autorização específica, falhas de disco, janela de 7 dias e reconciliação pós-reboot sem hora. **Sem publicar ou instalar na TV Casa automaticamente.**
