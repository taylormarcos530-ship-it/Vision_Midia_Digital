# Vision V2 — Fluxo SQLite → HTTP em lotes → PostgreSQL 17 → CQRS diário + comandos revisionados

**Data:** 31/10/2026. **Branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Resultado final: 5/5 PASS; NO-GO para deploy, APKs e produção.**

## Evidência verificável

- [GitHub Actions final: run 41241235375](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41241235375), SHA testado `26bf2aa970a96d60875167f3b3614af0992b5c93`, cinco jobs concluídos com `success`.
- [Módulo isolado de teste](../../tests/vision-v2-sequence-qa/full-flow-qa/synthetic_full_flow.py) e [workflow](../../.github/workflows/vision-v2-full-flow-qa.yml).
- Primeira execução [41240913586](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41240913586) **FAIL**, porque o Python SQLite rejeitou acesso cross-thread no teste; corrigido somente em QA via `check_same_thread=False`, com acesso serializado por fases. [Execução 41240984207](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41240984207) **5/5 PASS**. [Execução 41241104347](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41241104347) **5/5 PASS** com rollback de projeção e fallback por tempo. Final `41241235375` **5/5 PASS** com RTC=1970 persistido explicitamente em SQLite.
- É **SQLite Python stdlib**, não o APK Android nem Robolectric; o protocolo HTTP usa servidor Python em 127.0.0.1 e PostgreSQL17 em contêiner descartável. Sem Supabase, Vercel, TVs ou internet do equipamento.
- **Tempo é simulado:** 30 minutos virtuais por TV, 1 reprodução a cada 15 segundos, 120 eventos por TV. Toda a simulação roda rapidamente no CI. Não é teste de 30 minutos físicos de conectividade.

## Protocolo exercitado

1. SQLite independente por TV sintética, `PRAGMA journal_mode=WAL`, `synchronous=FULL`, inserção transacional e cursor de ACK persistente; nenhum evento de origem é removido. Cada recibo armazena `rtc_epoch_ms=0` para simular boot com relógio 1970; a fila nunca atribui `played_at`.
2. Gatilho de envio a cada **120 segundos virtuais**, em lotes de no máximo **50 eventos**. Ao voltar a conexão, lotes são drenados por sequência. Durante queda simulada, não há tentativa de envio por reprodução; resposta HTTP `503` leva a suspensão de tentativas até reconexão.
3. Falhas injetadas: resposta HTTP perdida **após commit** na primeira transmissão de cada TV, indisponibilidade entre 120 s e 1.080 s virtuais, rollback parcial SQL do evento `seq=80` em uma TV. Reenvio é reconhecido por identidade e SHA-256 do payload, ACK somente após commit; fila avança exclusivamente com ACK recebido/validado.
4. Reinício simulado de todas as conexões SQLite com `rtc_epoch_ms=0` no minuto 15 (segunda identidade de boot, sem horário real). Evento monotônico é recomeçado a cada boot, sem inferir `played_at` pela hora de recepção.
5. Comandos são **versionados**: GET inicial, novo GET na reconexão, aviso push **simulado** de alteração da revisão `0→1`, sem reenviar GET ao repetir o aviso, e **GET de contingência por TTL de 15 minutos**, mesmo sem nova notificação. Não foram usados WebSocket ou FCM reais.
6. No backend PostgreSQL, recibos são `played_at=NULL`, `billable=false`, com um dia de recebimento confiável **fixado para QA em 31/10/2026**. Projetor CQRS cria uma linha diária por TV, avança cursor somente na transação que incrementa resumo e não conta uma prova duas vezes.
7. Trigger de falha SQL forçada interrompe primeira projeção; comprovante e cursor de leitura permanecem intactos. Após remover trigger, projetor executa sem duplicidade.
8. Teste final de replay antigo com conteúdo idêntico → sem nova linha; tentativa de usar token de outro dispositivo → `401`.

## Tabela principal de resultados reais — cinco escalas

| TVs | Comprovantes únicos | POST HTTP | GET comandos | HTTP total | HTTP cenário-base hipotético* | Redução HTTP simulada | Reenvios reconhecidos | Respostas 503 esperadas |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 7 | 840 | 72 | 28 | **100** | 945 | **89,42%** | 57 | 15 |
| 12 | 1.440 | 122 | 48 | **170** | 1.620 | **89,51%** | 97 | 25 |
| 20 | 2.400 | 202 | 80 | **282** | 2.700 | **89,56%** | 161 | 41 |
| 50 | 6.000 | 502 | 200 | **702** | 6.750 | **89,60%** | 401 | 101 |
| 100 | 12.000 | 1.002 | 400 | **1.402** | 13.500 | **89,61%** | 801 | 201 |

*Referência **não medida no sistema oficial**: uma requisição HTTP por reprodução + uma consulta de comandos a cada 120 segundos, em 30 minutos virtuais. A redução é contra essa referência hipotética, não contra os logs do Supabase V1/V30, e não cobre heartbeat/monitoramento, download de mídia, notícias, loterias, login ou acesso do painel.

Todos os cenários **PASS**: `unique == N_TVs×120`, `ACK_final=120` para cada TV, nenhuma pendência SQLite, `billable=true` inexistente, `played_at` inexistente, comandos revisionados `rev=1` em todas as TVs, cada uma com dois IDs de boot e RTC=1970, sem perda de comprovantes.

## Storage e WAL (bytes reais coletados nos runners)

| TVs | WAL PostgreSQL gerado (bytes) | PostgreSQL recibos + índices (bytes) | Apenas índices do histórico (bytes) | CQRS diário + índices (bytes) | SQLite local arquivos somados (bytes) |
|---:|---:|---:|---:|---:|---:|
| 7 | 367.304 | 491.520 | 73.728 | 49.152 | 5.647.904 |
| 12 | 621.712 | 778.240 | 122.880 | 49.152 | 9.685.064 |
| 20 | 1.012.536 | 1.114.112 | 172.032 | 49.152 | 16.144.520 |
| 50 | 2.536.640 | 2.801.664 | 409.600 | 49.152 | 40.367.480 |
| 100 | 5.050.384 | 4.849.664 | 753.664 | 49.152 | 80.739.080 |

**WAL PostgreSQL:** diferença de LSN no ensaio, abrangendo gravações e projeções, não espaço físico WAL retido ou consumo faturado. SQLite: **um arquivo separado por TV no teste**, incluindo overhead dos próprios bancos e WAL locais; não representa fielmente um único banco real em cada Android. Dados de vídeo/imagens não incluídos. CQRS ocupa armazenamento **adicional**, porém a consulta agregada evita contar linhas brutas a cada abertura do painel.

## Latência HTTP P95 observada em loopback (incluindo erros e sincronização)

| TVs | P95 observado |
|---:|---:|
| 7 | 60,792 ms |
| 12 | 1.018,230 ms |
| 20 | 181,661 ms |
| 50 | 182,251 ms |
| 100 | 103,088 ms |

Uma única rodada por escala, CI concorrente, sujeito a ruído do runner. Não extrapolar SLA nem desempenho de internet/Edge. A latência de 12 TVs é um outlier observado, **não suavizado ou ocultado**.

## Índices, redução real e arquitetura

- **Redução comprovada neste modelo:** HTTP do gateway de comprovantes + polling de comandos versus referência ingênua (métrica acima), e CQRS torna a consulta ao resumo independente de `COUNT(*)` repetido no histórico bruto. Arquivamento por segmento e compactação **não** foram executados nesta rodada.
- **Índice do histórico NÃO desaparece com lotes ou CQRS:** cada recibo ainda é uma linha indexada. Para aliviar a tabela real são necessárias partições por período confiável de recebimento, índices mínimos guiados por `EXPLAIN ANALYZE BUFFERS` e arquivamento/retention segura, **sem DELETE agora**.
- **Heartbeat/status online NÃO foi substituído** nem contabilizado na referência: novas tecnologias não justificam afirmar redução de 89% da Vision inteira. WebSockets permanentes poderiam consumir cotas de conexões; push revisional com fallback é candidato de QA, mas sem FCM instalado nenhuma garantia de entrega real.
- **Offline** protege a **fila de comprovantes**, não valida decodificação do vídeo, cache de mídia, auto-start, licença/expiração, quiosque ou estabilidade de Aquário/Smart Pro 3000. Esses são testes Android separados.
- **CQRS diário** neste QA agrega por dia **recebido pelo servidor**, não pelo dia em que o anúncio tocou na TV. Sem âncora de horário autenticada do mesmo boot, a reprodução fica `PENDING_TIME`; contagem não entra em relatório comercial faturável.
- O controle de janela `50 ou 120s` usa **tempo virtual**, não scheduler durável no Android; em repouso a TV deve usar TTL/backoff/jitter e janela off-line controlada. Recomendado validar buffer cheio, falta de espaço e Kiosk/boot com relógio desajustado antes de qualquer APK.
- O teste de cache na borda/CDN de mídia, Supabase Storage e notificações push não fez parte da suíte; são módulos distintos que precisam de métricas próprias.

## Gates obrigatórios antes de produção

1. Execução Android SQLite/Java dentro de APK de **homologação não instalado** ou em emulador descartável, com corte de energia, escassez de disco, relógio 1970 e reabertura; sem mexer em TVs atuais.
2. HTTP sob TLS + credenciais/JWT multiempresa reais **somente QA**; teste de replay de archive, limite de requests por TV e prova de recuperação em disco.
3. Observar contagem de **requisições reais V30 antes/depois** incluindo device-gateway, monitoring, comando, mídia, Supabase database/Storage e painel, exclusivamente leitura. Nenhuma redução em produção comprovada aqui.
4. Projetar CQRS por **dia comercial** apenas para eventos com timestamp verificado; expor `last_updated`, lag, cursor e inconsistências. RLS multiempresa obrigatória em leitura e escrita.
5. Integrar comandos revisionados com push real (quando suportado pela TV Box) e fallback sem flood; não abrir automaticamente 100–300 WebSockets permanentes no Supabase Free.
6. Testar cache/CDN/manifestos imutáveis sem recarregar mídia a cada loop. Preservar player, cache offline e licença até mudança especificamente autorizada.
7. Planejar retenção de comprovantes com arquivo durável, hash, restauração, reenvio histórico e proteção contra false ACK. Nenhum original poderá ser excluído antes dessas garantias e autorização específica.

**Decisão formal:** cinco PASS, sem regressões detectadas na suíte experimental; **NO-GO para deploy, edição do Supabase, Vercel, APKs, painel ou TVs.**
