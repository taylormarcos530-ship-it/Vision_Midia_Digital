# Vision V2 — QA de persistência offline e relógio 1970

Data: 31/10/2026. **EXPERIMENTO ISOLADO — NÃO APROVADO PARA PRODUÇÃO**.

Branch: `experiment/vision-v2-sequence-watermark-qa-20261031`. Nenhuma modificação em `main`, Supabase V1/V2, Vercel, APK ou TV real. Não há novas funções Edge, migrações ou retenção/limpeza de dados.

## Implementação

- [offline-file-queue.cjs](../../tests/vision-v2-sequence-qa/offline-file-queue.cjs) — protótipo **Node.js/Linux**, NÃO componente Android. Persistência de fila + contador na mesma gravação de arquivo, com SHA-256 de integridade, `fsync` antes de renomeação atômica e `fsync` do diretório. Gravação anterior permanece íntegra quando simulada queda antes do `rename`; se o commit ocorreu mas a resposta foi perdida, reabrir permite recuperar o evento. IDs locais repetidos enquanto pendentes não avançam o contador.
- [offline-file-queue.test.cjs](../../tests/vision-v2-sequence-qa/offline-file-queue.test.cjs) — reabre arquivos reais no runner, simula perda de energia **por injeção de falhas**; não desliga fisicamente uma TV Box.
- [workflow de QA](../../.github/workflows/vision-v2-sequence-watermark-qa.yml) — `contents: read`, checkout sem credenciais persistentes, Node 22; nenhum deploy, segredo Supabase ou conexão com produção.

## Relógio, fuso e limites

- Nunca usar RTC inicializado em 1970 para carimbar reprodução. Eventos permanecem com `playedAt=null`; o upload do prefixo bloqueia na primeira data não verificada.
- Somente `serverIso` de resposta autenticada pode criar âncora de relógio. O protótipo usa um sinal `authenticated=true` **injetado pelo teste**; não verifica assinatura/JWT e NÃO fornece implementação segura de rede.
- Referência temporal do mesmo boot: `serverMs + (eventMonoMs - anchorMonoMs)`, onde `monoMs` deve provir de relógio monotônico persistente através de reinícios de processo; no Android, validar `SystemClock.elapsedRealtime()` e identidade única do ciclo de boot. `performance.now()` do WebView não é adequado para reconstrução após relançamento do processo.
- As datas são derivadas no fuso `America/Sao_Paulo` após verificação, incluindo transição de meia-noite. Janela experimental de 30 dias por boot, não uma garantia em hardware.
- **Se o aparelho reiniciar antes de obter âncora daquele boot, não existe informação suficiente para determinar o horário de reprodução.** Manter o comprovante pendente e impedir ACK errado; não inventar data nem ignorar comprovante.
- Fila cheia (2.000) ou arquivo danificado: **falha fechada, com recuperação manual necessária**, sem exclusão de registros antigos nem reset silencioso.

## Resultado de teste

GitHub Actions [execução 41222266015](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41222266015), commit `cf6186bc842984ab44627a21c94825ed6f24bb36`:

**39 PASS, 0 FAIL, 6 TODO**, Node 22, incluindo:
- 19 cenários anteriores de sequência/ACK/idempotência **em memória**;
- 20 cenários novos **com arquivos de teste reais no GitHub Actions**, sobre fila offline, reabertura, falha antes/depois do commit, ACK perdido, corrupção, 1970, reinício de boot, sete dias offline sem reinício, fuso de São Paulo, fila cheia, isolamento de stream e confirmação apenas do que foi enviado.

Não houve execução no Android nem teste de desligamento físico, SQL em produção ou requisições HTTPS para Supabase. Os testes de PostgreSQL 17 da etapa anterior são evidência separada, não equivalem ao teste do APK.

## Pontos pendentes (NO-GO)

1. **Android nativo:** usar SQLite transacional (fila+contador), processar `fsync`/WAL, matar o processo e desligar energia com TV Box Casa; não incorporar esse arquivo Node diretamente no player WebView.
2. **Relógio e autenticação:** validar JWT/credencial do servidor, boot ID que não se repete e `elapsedRealtime()` real; testar relógio 1970, NTP atrasado, mudança de fuso e reboot antes da sincronização.
3. **Reconciliação:** desenvolver fluxo explícito para comprovantes de um boot anterior sem âncora, com estado pendente/quarentena auditável. Não excluir nem contabilizar em dia inventado.
4. **Concorrência local:** o arquivo de QA não implementa bloqueio entre processos; várias instâncias de gravação podem causar perda de atualização. A implementação final deve ser transacional no Android.
5. **Escalabilidade:** o protótipo regrava o arquivo inteiro e faz `fsync` a cada reprodução. Isso **não deve ser utilizado em produção** por custo de I/O e amplificação de escrita. Projetar append incremental no SQLite, compactação controlada, e medir disco/CPU em carga real.
6. **Idempotência do player:** o dedupe por ID ocorre enquanto o evento está pendente; validar identidade estável de evento e reenvio após ACK/reinstalação, contador remoto, concorrência e resposta perdida.
7. **Capacidade/monitoramento:** validar consumo de requisições, armazenamento real, autenticação multiempresa e relatório ao anunciante; nenhum benchmark de 100 TVs em Android foi realizado.

**Decisão de segurança:** manter o protótipo apenas como prova de contrato. Não migrar, não alterar player.js, não publicar no Vercel, não conectar TV real e não limpar histórico.
