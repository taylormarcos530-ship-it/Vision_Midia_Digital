# Vision V2 — Paridade comercial, COUNT DISTINCT, nomes históricos, JWT/RLS de QA e reinício com 300 clientes

**Data:** 31/10/2026. **Branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Decisão:** PASS da suíte no PostgreSQL 17 descartável; **GO somente para avançar os testes isolados**; **NO-GO para deploy, mudanças de índices, compactação ou produção**.

## Evidências executadas

- [GitHub Actions run 41252660912](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41252660912), **conclusion=success**, commit testado `ed3f543dbcb02db69fcb3bc41f84d32e424fe8de`, log `QA_COMMERCIAL_PARITY_RLS_RESTART_PASS=true`.
- [Script de testes comerciais/HTTP](../../tests/vision-v2-sequence-qa/commercial-parity-qa/qa.py), [schema RLS experimental](../../tests/vision-v2-sequence-qa/commercial-parity-qa/schema.sql), [workflow isolado](../../.github/workflows/vision-v2-commercial-parity-rls-qa.yml).
- [Migração versionada de relatórios](../../supabase/migrations/20260908025620_add_playback_report_rpc.sql), [migração de exportação](../../supabase/migrations/20260908025854_add_playback_export_rpc.sql), [migração de snapshots de nomes](../../supabase/migrations/20260908025545_add_playback_report_snapshots.sql), [gateway existente](../../supabase/functions/device-gateway/index.ts). **Esses arquivos foram consultados no GitHub, exclusivamente em leitura. Nenhuma conexão SQL foi feita ao Supabase de produção.**
- Falhas de preparação do ensaio foram corrigidas **somente** na branch QA: [run 41252526469](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41252526469) **FAIL** por usar `Connection.executemany()` em vez de cursor do psycopg; [run 41252565670](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41252565670) **FAIL** por 17 placeholders para 16 campos de fixture; [run 41252613072](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41252613072) **FAIL** de serialização JSON `Decimal` de agregação. [Run final 41252660912](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41252660912) passou após corrigir a instrumentação. Esses erros não são falhas verificadas na produção.

## Paridade comercial reproduzida em PostgreSQL real (dados sintéticos)

Os relatórios foram construídos em SQL a partir das **dimensões e regras publicadas** na função `get_playback_report`: empresa, TV, campanha, playlist, mídia, data comercial local, nomes históricos preservados, iniciou, concluiu, duração, primeiro/último, e presença distinta entre vários dias.

**Não foi executado o RPC `public.get_playback_report` original**, pois o schema e os serviços de produção não foram copiados. Trata-se de **paridade das formas de consulta e agrupamento em schema sintético**, não da equivalência bit a bit do JSON comercial, ACL, parâmetros ou ordenação da função implantada.

| Verificação | Log real |
|---|---:|
| Eventos comerciais de fixture (duas empresas, três TVs por empresa, três datas) | 90 |
| Registros sem horário na quarentena da fixture | 24 |
| Combinações `company × date_range × filtro` | 40 PASS |
| Formas de agrupamento por combinação | 5 |
| Comparações de grupos raw vs CQRS | **200 PASS** |
| Divergências de totais, conclusão, duração e min/max | **0** |
| Troca de nomes históricos mantendo mesmo device ID | PASS |
| `COUNT(DISTINCT device_id)` do intervalo completo | 3 |
| Soma ingênua das contagens distintas dos três dias | **9 (incorreto)** |
| Eventos `PENDING_TIME` incluídos na contabilização comercial | **0** |
| Replay idêntico do evento comercial inserido duas vezes | Não aumentou o histórico |

O CQRS sintético armazena uma linha por **empresa/TV/campanha/playlist/mídia/snapshot de nomes/dia**, com contagens e duração; `COUNT DISTINCT` por intervalo conta os IDs presentes nas linhas agrupadas e não soma distincts diários. A quarentena de provas sem hora fica separada, `started_at NULL`, `billable=false`, sem inventar horário a partir do recebimento.

## Autenticação sintética e RLS PostgreSQL realmente executado

- O servidor de QA gera chave efêmera de teste; emite **JWTs HS256 sintéticos** com HMAC, `iss`, `aud`, `exp`, empresa, device e modo (`report`/`device`). **Não são JWT Supabase, não há chave de produção ou serviço externo.**
- Transações SQL fazem `SET LOCAL ROLE qa_vision_app` (**papel sem privilégio de superusuário**) e configuram claims escopadas na transação. Políticas RLS ativas no PG17 restringem `devices`, `playback`, `pending_time` e `daily`.
- Teste real: o usuário sintético da empresa A vê 45 registros comerciais da empresa A; consulta à B retorna **zero**; os 24 registros pendentes da empresa A ficam sob controle. JWT vencido e assinatura alterada foram rejeitados; POST com claims de outra empresa/device respondeu **401**; prova adulterada e lacuna de sequência responderam **409**.
- A verificação documenta proteção por claims que **foram autenticadas pelo gateway experimental**. Em arquitetura de produção o gateway deve definir claims somente após validar JWT/assinatura; um serviço privilegiado que permitisse claims controladas pelo cliente poderia contornar esse isolamento. Provar RLS efetivo do Supabase e funções originais ainda é necessário.

## Gateway HTTP local e reinício — 300 clientes

- Servidor HTTP em `127.0.0.1` do runner do GitHub, **300 clientes concorrentes**, máximo **16 acessos SQL simultâneos** por semáforo, três ondas de 50 eventos (até 150 por TV); os 300 clientes completaram cada onda.
- O gateway foi efetivamente parado e recriado entre a onda 1 e 2. Os **300 lotes da onda 1 foram reenviados**, totalizando **15.000 provas reconhecidas sem novo INSERT**; o watermark ficou persistido em PostgreSQL, não apenas na memória do servidor.
- Falhas injetadas: rede antes de commit (um subconjunto), resposta 503 após commit (um subconjunto), falha transacional depois do INSERT antes do watermark; retry exigiu ACK correto, sem duplicação; controles de JWT/token inválido, conteúdo alterado e sequência faltando bloquearam o ingresso.
- Todos os eventos de estresse foram **PENDING_TIME**, `started_at NULL`, `billable=false`. O CQRS comercial original continuou com total **90**; a quarentena terminou com **45.024 linhas** (45.000 geradas + 24 anteriores).

| Métrica medida | Resultado run final |
|---|---:|
| Clientes simultâneos | **300/300** |
| Comprovantes inéditos | **45.000** |
| Replays idempotentes após reinício | **15.000** |
| Reintentos HTTP | **51** |
| Latência HTTP P95 (incluindo reintentos) | **1.809,84 ms** |
| Latência HTTP P99 (incluindo reintentos) | **1.924,31 ms** |
| Duração total das 3 ondas no runner | **9,01 s** |
| Sessões PostgreSQL máximas amostradas | **17** (inclui monitor) |
| Maior número de sessões aguardando lock nas amostras | **1** |
| Deadlocks | **0** |
| Contagem autovacuum observada | **0** |
| RSS máximo do Python no runner | **91.368 KiB** |
| Amostras de espera por lock | **160** |
| Tamanho da relação `pending_time` com índices | **12.353.536 bytes** |
| Provas sem horário indevidamente tratadas como comerciais | **0** |

**Limitações:** a carga final durou somente **9 segundos**, dividida em três ondas. Não é teste de 24h, nem SLA de Internet, nem taxa de chamadas de Supabase Edge. A métrica de RAM é do processo Python, não RAM total do PostgreSQL nem da TV Box. Esperas por lock e P99 são instantâneos/amostrados; não há dados de picos prolongados. A autenticação e RLS são do laboratório, não do Supabase oficial.

## Retenção, índices e GO/NO-GO

1. **Índices:** manter `UNIQUE(device_id,client_event_id)` ou idempotência equivalente no desenho V2. Não remover índices dos relatórios originais; teste anterior apenas comparou versões sintéticas e não comprovou melhora para as consultas reais com vários filtros.
2. **CQRS:** se um relatório comercial por dia for implementado, manter dimensões empresa/TV/campanha/playlist/mídia, duração, status e nomes históricos, primeiro/último e prova de `COUNT DISTINCT` ao longo de vários dias. Relatórios de eventos individuais não podem ser substituídos somente pelo resumo.
3. **Provas de relógio inválido:** manter quarentena no SQLite/servidor sem inventar horário e sem faturamento até existir âncora temporal verificável. Data de recebimento é útil para diagnóstico/retention, mas **não substitui data de reprodução**.
4. **Segurança:** validação criptográfica JWT real e claims RLS reais em ambiente Supabase **local descartável**, nunca na produção sem autorização. Testar presença de sessão, funções `SECURITY INVOKER` e exportação entre empresas.
5. **Retenção:** preparar arquivo externo criptografado por segmento, manifesto SHA-256 e confirmação durável; validar recuperação de outro runner, replay após downtime, igualdade dos relatórios comerciais e custos. **Não executar DELETE nem compactação produtiva agora.**
6. **Backpressure:** limitar acesso SQL e testar timeout, P95/P99 e congestão com filas sob queda longa; a prova com 300 clientes, 16 operações SQL simultâneas e um restart só demonstra a carga acima, não capacidade de 300 TVs contínua durante sete dias.

**GO:** somente continuar a homologação de segurança/relatórios e reinício em CI isolado. **NO-GO:** Supabase de produção, migrations e índice real, Vercel, APK, painel, site, TV Boxes, push real, compactação ou limpeza de dados reais. Nada em `main` foi alterado.
