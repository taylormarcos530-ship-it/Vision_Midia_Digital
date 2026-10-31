# Vision V2 — esquema versionado, otimização mínima, HTTP sustentado 100/300, índices e GO/NO-GO

**Data:** 31/10/2026. **Branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`.

**Veredito formal:** **PASS no PostgreSQL 17 descartável com 100/300 clientes HTTP locais por ~56–58 segundos e em comparação sintética de índices. GO para a próxima homologação isolada. NO-GO para integrar ou publicar no Supabase/APK/painel/site/TVs.** Zero consultas ou execução SQL no Supabase de produção; toda escrita ocorreu exclusivamente em PG17 descartável por GitHub Actions.

## Evidência CI real, inclusive falhas corrigidas

- **Execução final:** [GitHub Actions 41248945776](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41248945776), commit testado `e3a9d0b2664dc4a946f1edfa5460fa0379711acb`, `conclusion=success`. Log final: `VISION_V2_SUSTAINED_HTTP_AND_INDEX_QA=PASS`.
- [Código executado](../../tests/vision-v2-sequence-qa/sustained-http-qa/sustained.py); [workflow de ambiente descartável](../../.github/workflows/vision-v2-sustained-http-schema-qa.yml).
- [Revisão documental dos arquivos reais versionados](vision-schema-index-readonly-review-20261031.md), commit `47c6ca38d3ed4ed9424aa197fe46b49c522ce561`.
- **Falha de instrumentação anterior:** [run 41248559500](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41248559500) executou a primeira coorte mas falhou ao serializar `Decimal` para JSON. Corrigido para `int`, sem alterar a semântica do teste.
- **Métrica duplicada anterior:** [run 41248703931](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41248703931) **PASS** funcional, mas contava duas vezes os 503 provocados antes do commit. As métricas corretas são **301 respostas 503 para 100 clientes e 901 para 300**, validadas por assertions no código e no run final. O número antigo 501/1501 não deve ser reutilizado como quantidade de respostas HTTP.
- Não houve deploy, cron, INSERT em banco real, alteração de política RLS, migrations, alteração de arquivos do APK, releases ou instalação em TV Box.

## Diferenças concretas do schema em GitHub, leitura sem SQL produtivo

A estrutura **versionada** contém `public.playback_logs`, `device_events`, `get_playback_report`, `get_playback_events`, índice por empresa/horário/TV/mídia/campanha, nomes históricos protegidos por trigger. O gateway versão GitHub recebe `playback_batch` de 1 a 100 eventos, utiliza `upsert` no conflito `(device_id, client_event_id)`, e devolve `accepted=rows.length` incluindo replays. Na falta de `started_at`, aplica hora do servidor, que não representa necessariamente a hora real da TV (RTC=1970). Consultar detalhes na [revisão documental](vision-schema-index-readonly-review-20261031.md).

**AVISO:** leitura de migrations versionadas **não prova quais índices, triggers, constraints e views estão instalados hoje no Supabase**. A definição inicial/unique de `playback_logs` não foi encontrada nas migrations desse repositório; sua existência é pressuposta pelo gateway. Não foi consultado o catálogo `pg_indexes` de produção, por proibição expressa do usuário.

## Teste de concorrência sustentada em banco único: métricas reais

Ambiente: **um** PostgreSQL 17 temporário, 400 identidades sintéticas (100 + 300), 30 empresas artificiais, gateway HTTP real em `127.0.0.1`, 12 rodadas de 50 provas por cliente a intervalos de **cinco segundos**, duração de ~56–58 segundos por coorte. Limite de **16 operações SQL simultâneas** por semáforo. Estas duas coortes foram sequenciais; **não** ocorreram 400 clientes simultâneos. Total 240.000 provas originais no banco; `played_at=NULL`, `billable=false` para todos.

| Métrica | 100 clientes | 300 clientes |
|---|---:|---:|
| Status | PASS | PASS |
| Duração da coorte (s) | 55,93 | 57,92 |
| Provas novas aceitas | 60.000 | 180.000 |
| HTTP POST observados (inclui negativas/verificações) | 1.505 | 4.505 |
| Latência HTTP P95 incluindo erros (ms) | 673,11 | 2.029,83 |
| Latência HTTP P99 incluindo erros (ms) | 714,63 | 2.236,09 |
| Respostas 503 provocadas e recuperadas | 301 | 901 |
| Tentativas adicionais/retries | 301 | 901 |
| Falhas de rede antes do commit | 200 | 600 |
| Resposta ACK perdida depois de commit | 100 | 300 |
| Falhas SQL transacionais após INSERT, antes do watermark | 1 | 1 |
| Reenvios de eventos reconhecidos sem duplicação | 5.050 | 15.050 |
| Tentativas de autenticação cruzada bloqueadas | 1 | 1 |
| Payload/replay alterado e lacuna bloqueados | 2 | 2 |
| Tamanho máximo de lote | 50 | 50 |
| Sessões PostgreSQL simultâneas máximas amostradas | 14 | 16 |
| Sessões esperando lock, máximo amostrado | 0 | **2** |
| Deadlocks (contador estatístico ao final) | 0 | 0 |
| Autovacuum (contador acumulado no schema de QA) | 1 | 2 |
| Memória máxima do processo Python (KiB) | 71.240 | 94.780 |
| Amostras da telemetria (intervalos ~250 ms) | 221 | 226 |
| Tempo do projetor CQRS após carga (ms) | 78,53 | 253,58 |
| Registros de resumo diário CQRS após cada coorte | 100 | 400 (acumulados) |

**Memória:** as quantidades 71.240 e 94.780 KiB são o **RSS máximo do processo Python/HTTP**, não a RAM total do contêiner PostgreSQL, nem cache do sistema de arquivos. `max_pg_backends_seen` é uma amostra de sessões; não há série de memória residente dos vários processos PostgreSQL, picos CPU/IOPS, nem custo operacional do Supabase. A observação de **2 waiters** não é deadlock e não determina duração das esperas. Não ocultar essa contenção.

**Falhas/replay:** o cliente repetiu exatamente o mesmo lote após cada 503; um 503 foi devolvido depois de commit, criando uma situação real de ACK perdido; o servidor validou hash do replay sob transação, sem duplicação ou aumento indevido do watermark. Outro 503 ocorreu após INSERT, antes do watermark e com rollback; retry regravou apenas o lote faltante. Os 400 clientes terminaram com 600 provas por dispositivo e projeção idempotente. Verificações extras: token de outra empresa/dispositivo 401, mídia alterada 409, sequência faltante 409. Sem dados apagados.

**CQRS:** o `projector` funciona com cursor por dispositivo, agrupamento por **data de recebimento** do servidor, transação única para resumo + cursor e segunda projeção no-op. O QA confirmou que `sum(unverified)=count(raw)=240000`, com `billable=false` e `played_at=NULL`. Não é ainda um relatório comercial verdadeiro: `get_playback_report` inclui campanhas, mídias, durações, nomes históricos e `count(distinct)` entre dias.

## Comparação de índices em tabelas iguais, PostgreSQL descartável

O script criou `qa_sustain.receipts` candidato (PK `device,seq`, mais índices `company,received_day` e `company,device,received_day`), e `qa_sustain.baseline_like` com **as mesmas 240.000 linhas** e cinco índices extras semelhantes aos campos das migrations `playback_logs`. Esta última tabela representa uma **reconstrução sintética**, não o DDL/índices efetivos do Supabase. Nenhuma tabela de produção foi alterada. A diferença não é medida de economia comercial real.

| Métrica | Resultado |
|---|---:|
| Linhas em cada tabela | 240.000 |
| Índices candidatos | 20.062.208 bytes |
| Índices baseline-like | 24.715.264 bytes |
| Diferença de armazenamento de índices | **4.653.056 bytes**, ~18,8% da baseline-like |
| `COUNT(*)` por tenant+dia, candidato | 1,507 ms |
| `COUNT(*)` por tenant+dia, baseline-like | 1,497 ms |
| Verificação de igualdade de resultado | PASS |

**Importante:** a query candidata foi ligeiramente mais lenta nessa única amostra (diferença de 0,010 ms); o benchmark **não provou ganho de latência**. Também não é correto afirmar que remover índices em `started_at` usados pelos RPCs do painel produziria economia sem regressão. A comparação usa `received_day` e não todas as consultas comerciais reais. **NO-GO para `DROP INDEX`.**

O banco QA final somou **146.724.531 bytes**, contendo a tabela de recebimentos, CQRS e uma segunda tabela de comparação com cópia sintética de 240.000 linhas; não é uma instância de produção e não é comparable diretamente com a projeção de 12,096 milhões feita em ensaio anterior.

## Projeto mínimo e gates futuros

1. **Sem mudar o que funciona:** preservar `playback_logs`, unique de eventos e `get_playback_report`/exportação. Medir o plano das queries reais reproduzidas em banco PG17 local antes de propor mudança de índice. Não tocar no catálogo de produção sem autorização específica.
2. **CQRS fino:** agregar somente dimensões necessárias de empresa/TV/campanha/mídia/playlist/dia **para eventos com hora confiável**; separado dos recibos `PENDING_TIME` por dia de **recebimento**. Guardar `last_updated`, cursor, lag, hashes dos segmentos e snapshots de nomes históricos; manter `COUNT(DISTINCT)` correto para intervalos múltiplos, sem somas ingênuas de distincts.
3. **Escrita econômica:** manter o player SQLite offline; futuro gateway V2 autentica sequência, processa lote de até 50, retorna ACK durável do commit; não reconsultar campanhas/mídias por cada evento nem criar HTTP por reprodução. A revisão do GitHub mostra que o gateway atual faz consultas por grupo de IDs por batch; mudanças exigem benchmark de cache e RLS.
4. **Índices:** primeira hipótese em QA é **evitar índices novos**, aproveitar seletivos existentes, considerar índice específico no resumo diário e partição de histórico bruto somente quando os filtros e volume justificarem. Não eliminar `UNIQUE(device_id,client_event_id)` sem substituto de idempotência validado em todo o ciclo de arquivamento.
5. **Arquivo/retention:** armazenar segmentos criptografados em serviço independente com confirmação durável, SHA-256/manifesto assinado, restauração e replay. Não `DELETE`, `DROP PARTITION`, `VACUUM FULL` ou cron agora. A proposta experimental V30 de compaction possui `DELETE` sob controle, portanto **não executar nem habilitar**.
6. **Conexões e latência:** analisar picos reais de P95/P99 sob 300 TVs com HTTP/TLS e autenticação QA, backpressure, fila no gateway, limite de banco e eventuais conexões concorrentes do painel. O teste de 300 clientes já observou P99 2,24 s e duas esperas por lock; não dar GO operacional de escala por esse único ensaio.
7. **Memória:** coletar RSS do PostgreSQL, RAM total do contêiner, picos de conexões, CPU e WAL retido (não apenas WAL gerado) em runner com instrumentação separada, se preciso.
8. **Custo e infraestrutura:** estimar bytes de banco/índices/Storage/backups, egress CDN e GET/PATCH/heartbeat reais. Resultados de banco descartável não comprovam capacidade do Supabase Free nem redução de chamadas atuais da Vision.

## GO/NO-GO

- **GO**: continuar QA isolado na branch experimental e testes de paridade de relatórios/índices, carga com RLS/JWT falsos e reinício de gateway.
- **NO-GO**: apagar/comprimir histórico produtivo, migrar índices, integrar CQRS no relatório oficial, alterar Supabase/Edge Functions, APK ou TVs. É necessária homologação operacional com evidência do schema implantado (futura autorização para consulta read-only), custos e SLA.
- **Nenhum SQL foi executado no Supabase de produção**. Código, migrations, testes e documentação foram gravados apenas na branch `experiment/vision-v2-sequence-watermark-qa-20261031`; CI usou PostgreSQL 17 totalmente descartável.
