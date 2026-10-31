# Vision V2 — Matriz PostgreSQL17: lotes, CQRS, partições e redução de tráfego (31/10/2026)

**Status: 5/5 jobs PASS, 20/20 combinações funcionais PASS. NO-GO para produção.**

## Execução e escopo

- Branch experimental `experiment/vision-v2-sequence-watermark-qa-20261031`.
- [GitHub Actions — run 41240233754](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41240233754), HEAD testado `31bbcbbf50ec1076ca6141ff531cf69b5bfbbbbc`, cinco jobs separados para 7, 12, 20, 50 e 100 TVs, todos success.
- [Script experimental](../../tests/vision-v2-sequence-qa/batch-cqrs-qa/benchmark.py) e [workflow sem deploy](../../.github/workflows/vision-v2-batch-cqrs-matrix-qa.yml).
- Cada job usa PostgreSQL 17 descartável `vision_v2_quarantine_disposable`; uma tabela de estado + duas partições mensais + um resumo CQRS por estratégia. **Nenhum Supabase, APK, Vercel, painel, mídia ou TV real acessado/alterado.** Nenhuma exclusão de originais.
- Cada TV gera **500 comprovantes sintéticos**, 350 com mês de recebimento outubro e 150 novembro. Todos `played_at=NULL`, `billable=false`. A comparação mede chamadas/commits **SQL locais**, **não HTTP, Edge Function, FCM, WebSocket, CDN nem dispositivo**.
- Estratégias: 1, 50, 100 ou 500 eventos por transação, usando `UNNEST` para lotes e `FOR UPDATE` no cursor de sequência da TV.

## Evidência dos resultados por escala (medição real)

| TVs | Eventos por estratégia | Individual s | Lote 50 s | Lote 100 s | Lote 500 s | WAL individual MB | WAL lote 100 MB | Índices das partições MB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 7 | 3.500 | 3,195 | 0,106 | 0,070 | 0,032 | 1,547 | 0,954 | 0,238 |
| 12 | 6.000 | 3,774 | 0,108 | 0,078 | 0,124 | 2,654 | 1,638 | 0,360 |
| 20 | 10.000 | 6,529 | 0,326 | 0,132 | 0,080 | 4,421 | 2,726 | 0,557 |
| 50 | 25.000 | 18,613 | 0,563 | 0,434 | 0,181 | 11,071 | 6,830 | 1,294 |
| 100 | 50.000 | 54,723 | 1,745 | 1,101 | 0,583 | 22,607 | 13,671 | 2,507 |

MB em base decimal (1 MB = 1.000.000 bytes). WAL da fase **de escrita**, calculado por diferença de LSN; não equivale ao tamanho físico atual dos arquivos WAL ou custo faturado. Cada job usa runner diferente e só uma amostra, por isso variações entre linhas e lotes não são SLA ou comparação rigorosamente controlada de CPU.

### Cenário detalhado: 100 TVs, 50 mil eventos

| Estratégia | Transações reais | Gravação s | P95 por transação ms | WAL bytes | Eventos/s medidos |
|---|---:|---:|---:|---:|---:|
| Individual | 50.000 | 54,723 | 1,214 | 22.606.776 | 913,7 aprox. |
| Lote de 50 | 1.000 | 1,745 | 1,885 | 13.757.872 | 28.653 aprox. |
| Lote de 100 | 500 | 1,101 | 2,435 | 13.670.928 | 45.413 aprox. |
| Lote de 500 | 100 | 0,583 | 6,529 | 13.601.384 | 85.763 aprox. |

**Redução observada WAL no lote 100 = cerca de 39,5%** versus escrita individual no cenário 100 TVs. O lote de 500 reduziu mais as transações, mas aumentou a latência por operação e a amplitude de rollback. Em 12 TVs houve outlier de **P95 88,039 ms** no lote 500; não assumir que 500 é sempre melhor.

**O índice da tabela de comprovantes não encolheu com batching**: ~2,507 MB no cenário de 100 TVs, mesmo em lotes. Isso ocorre porque o número de linhas e chaves indexadas permanece igual. Se o objetivo é reduzir o **tamanho do histórico**, é necessário arquivamento com replay confiável, particionamento e/ou agregação, não apenas enviar em lotes.

## CQRS: comparação com EXPLAIN ANALYZE BUFFERS

- Comparação **na mesma base descartável**: `COUNT(*)` sobre o histórico bruto particionado por mês/empresa versus `SUM(pending_time)` em projeção agregada por TV/empresa/mês. Valores retornados iguais.
- Resultado no cenário 100 TVs (`batch100`): **P95 de 0,362 ms direto vs 0,077 ms no CQRS**, amostra de 12 EXPLAIN ANALYZE em ambiente local, sem API/rede.
- Blocos compartilhados cache-hit aproximados pelo plano de execução: **56 (histórico) vs 6 (CQRS)**. Isso mede páginas lidas em buffer e não número de requisições ao Supabase.
- O teste garante o mês correto (novembro) sem varrer a partição de outubro. O resumo de leitura ficou em **81.920 bytes** (100 TVs); os dois blocos de partições brutas com seus índices ficaram em ~6,80 MB.
- Projetor em transação com cursor (`through_seq`): reprocessar não duplica, uma falha injetada aborta **contagem e cursor**, e o reprocessamento posterior recupera o lote. A ingestão recusa lacunas, reenvio com sequência não esperada e empresa diferente.
- O resumo neste QA é por **mês de recebimento**, não por dia comercial da reprodução; eventos sem horário permanecem `billable=false`, sem criar data fictícia. Produção exigirá agregados diários para eventos de horário verificado e contagem separada dos sem hora.

## Arquitetura recomendada — sem implementar alterações reais agora

### 1. CQRS lógico e histórico temporal no PostgreSQL atual

Preferir um **único PostgreSQL** com responsabilidades claras:
- **Write model:** transação curta para autenticação, sequência, watermark e comprovantes ainda não arquivados; evento novo é registrado uma vez, sem INSERT ou PATCH por exibição no painel.
- **Read model:** projeção assincrônica e idempotente para `(empresa,TV,dia)`, incluindo reproduções validadas e uma dimensão separada para eventos sem horário. Painel/portal consultam somente o resumo por padrão; detalhes são auditáveis sob demanda.
- **Partições:** intervalos mensais de `received_at` / data de recepção confiável no servidor. Para histórico comercial, considerar separadamente `played_at` somente depois de comprovado. Particionamento nativo reduz varredura/índices consultados **quando a query usa a chave de partição**, mas não garante menos bytes totais de índice e pode gerar overhead de metadados/planejamento se houver muitas partições.
- **Sem segundo banco agora:** o Supabase documenta `timescaledb` descontinuado nos projetos PostgreSQL17; usar particionamento nativo e opcionalmente `pg_partman` se manutenção automática for realmente necessária.
- **Crucial:** chave `(month,device,seq)` é única só na partição; o watermark por stream e o replay idempotente impedem duplicar uma sequência que atravessa meses.

### 2. Buffer local e envio de lotes

- SQLite offline da TV acumula eventos, assina stream/sequence/boot e envia por **capacidade OU prazo** — ponto inicial para homologação: até 50 por lote, **ou** prazo máximo de 2–5 minutos, o que ocorrer primeiro.
- Com reprodução a cada 15 s, **50 eventos representam 12min30s** de operação contínua; logo, com flush a cada 2 minutos os lotes reais costumam ter apenas ~8 eventos. Não confundir 50 por lote nos testes com 50 eventos por requisição de produção.
- Gateway faz validação/INSERT de lote em uma transação com ACK só após commit; rejeitar lacuna, tenant errado e payload alterado; sem contagem duplicada após retry. **Não instalar no APK agora.**
- Limitar buffer físico, priorizar cache offline e backoff com jitter, impedir descarte silencioso ao ficar cheio e manter a tela funcionando mesmo que servidor demore. A fila pode ter estado `PENDING_TIME` sem inventar data.

### 3. Comando sob demanda: WebSocket, push e fallback

- Um WebSocket pode reduzir `GET /commands` repetido, mas mantém **conexões, ping/pong, reconexões e mensagens**; não equivale a custo zero. A documentação atual do Supabase informa limite de **200 conexões simultâneas no Free**; 300 TVs conectadas permanentemente excederiam só esse recurso, sem contar usuários do painel. Fonte: https://supabase.com/docs/guides/realtime/limits
- FCM/push é útil como **aviso de nova revisão**, não como fonte exclusiva de comandos: mensagens normais podem atrasar durante Doze e TV Boxes sem serviços Google podem não receber. Fonte: https://firebase.google.com/docs/cloud-messaging/android-message-priority
- Recomendação econômica: comando persistido e versionado no banco; servidor emite `revision_changed` por canal habilitado; TV obtém pacote de comandos **somente quando revisão muda**. Fallback de sincronização com TTL/backoff/jitter (p.ex. 15–30min em repouso), e sincronização no boot/retorno online. O ritmo de **heartbeat para status online** é independente: não suspender sem testar a precisão do monitoramento.
- Exemplo **teórico**: 100 TVs verificando comandos a cada 2 min = **72.000 consultas/dia**; a cada 15min = **9.600/dia**, além de push e heartbeat. NÃO medido na Vision e não representa total de chamadas do produto.

### 4. Cache na borda, CDN e validação de licença offline

- Playlist/manifestos versionados e cacheados, ETag/If-None-Match, URLs imutáveis `media-hash.ext`; CDN para mídia estática e thumb com cabeçalhos cache apropriados. **304 ainda é uma requisição HTTP**; apenas TTL/memória/cache local evitam a chamada. CDN pode reduzir egress do armazenamento de origem, **não os bytes baixados pela TV**, a menos que o arquivo já esteja no cache do aparelho ou da rede local.
- Edge Function barata para autenticar e emitir **licença assinada por prazo de validade**; player verifica assinatura localmente sem chamada a cada anúncio. Boot em 1970 impede provar horário real após reiniciar: tratar como política de grace e hora confiável vinculada ao boot, nunca colocar `Date.now()` incorreto como relógio de licença.
- Permitir reprodução de playlist já autorizada em modo offline; não depender de Supabase/FCM/CDN a cada ciclo. Sincronizar revogação quando online e oferecer fallback explícito, sem reiniciar toda a programação.
- Não transformar a edge function em novo gateway por-evento ou novo ponto único de falha. Cache e CDN não substituem a comprovação idempotente.

## Ordem segura de implementação futura

1. **Primeiro:** comparar logs reais do V30, identificar frequência de `GET/PATCH/heartbeat`, eliminar escrita redundante e garantir playback offline. **Não mudar TV atual**.
2. **Segundo:** validar em QA um upload SQLite → gateway em lotes de até 50 ou TTL curto, ACK idempotente, taxas HTTP, WAL, índices e disco, com 7/12/20/50/100 TVs e falhas de internet.
3. **Terceiro:** implementar no QA projeções diárias idempotentes, `EXPLAIN ANALYZE BUFFERS` nos SQL reais do painel e partições somente nas grandes tabelas. Medir progresso do cursor e lag de projeção.
4. **Quarto:** comandos por revisão/push com fallback e medir conexões simultâneas, mensagens, quedas de TV Box e consumo de Supabase. Não trocar polling essencial de status por mensagem que pode não ser entregue.
5. **Quinto:** versionamento de mídia/CDN e licença assinada offline em bancada com testes de boot 1970, troca de hora e expiração; depois backup externo auditado e retenção com replay. Nunca apagar originais antes de provar arquivo-restauração.
6. Publicar/instalar somente com autorização posterior, backup, estratégia rollback, homolgação da Casa, depois TV piloto, mantendo o painel e TVs atuais intactos.

**Conclusão:** sim, partes da proposta ajudam, mas cada mecanismo tem finalidade distinta: **lotes reduzem commits/WAL; CQRS reduz esforço de leitura; particionamento reduz varreduras por período; arquivamento reduz armazenamento apenas após retenção comprovadamente segura; push ajuda a reduzir polling de comandos; CDN reduz pressão sobre origem; cache/local license protege playback offline.** Nenhum deles, isoladamente, resolve o excesso de heartbeat ou o crescimento histórico.
