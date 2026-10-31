# Vision V2 — 24 horas / 7 dias virtuais, 100 / 300 TVs — resistência isolada

**Data:** 31/10/2026. **Estado:** **4/4 PASS em QA isolado**, com carga de reproduções **amostrada**. **NO-GO** para habilitar 300 TVs por 7 dias no ritmo comercial real; zero modificações em Supabase, painel, Vercel, APK ou TVs.

## Evidência real e não-negociável

- Branch: `experiment/vision-v2-sequence-watermark-qa-20261031`.
- Workflow [GitHub Actions run 41243514442](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41243514442), código testado `f9331c64560e1468ad10ba3767bf0a1c814309c3`, conclusão real `success`. Todos os quatro jobs independentes `1d/100`, `1d/300`, `7d/100`, `7d/300`: **PASS**.
- [Teste de integração](../../tests/vision-v2-sequence-qa/virtual-soak-qa/soak.py), [schema PostgreSQL17 com duas partições](../../tests/vision-v2-sequence-qa/virtual-soak-qa/schema.sql), [workflow de QA sem deploy](../../.github/workflows/vision-v2-virtual-soak-qa.yml).
- Cada job usa runner e contêiner PostgreSQL17 descartáveis, um arquivo SQLite por TV sintética, HTTP real em loopback e Python 3.12. **Tempo virtual**, não execução durante 24h/7 dias físicos. Dados sintéticos, nenhum cliente/credencial real.

### Carga efetivamente executada

- 24h virtuais: **1 evento cada 300 s simulados** → **288 comprovantes por TV**.
- 7 dias virtuais: **1 evento cada 900 s simulados** → **672 comprovantes por TV**.
- A cadência comercial ilustrativa de **15 segundos** produziria **5.760 eventos/TV/dia** ou **40.320 eventos/TV em 7 dias**, e portanto **12.096.000 comprovantes para 300 TVs/7 dias**. O maior teste processou **201.600**, **60× menos**. Não confundir o PASS com homologação dessa carga integral.
- Quatro ou cinco fases do relógio virtual; duas indisponibilidades em fases distintas, reenvio após confirmação perdida para todas as TVs, injeção de rollback SQL, fechamento/reabertura SQLite com novo boot e conteúdo sem `played_at`.
- Lotes até **50 eventos** por transação HTTP/PG17; IDs/stream e sequência verificados, confirmação somente após commit. Recibos originais persistem no SQLite e no PostgreSQL; **nunca foram apagados**.
- O gateway QA atribui mês/dia confiável de **recepção sintética do servidor**; eventos sem referência de horário permanecem `played_at=NULL`, `billable=false`. Há comprovantes tanto na partição de outubro quanto de novembro no cenário de sete dias.
- CQRS diário atualiza contagens somente por cursor transacional; o projetor não duplica eventos e todo dia se refere à **recepção**, não à exibição comercial.

## PASS/FAIL — métricas reais dos quatro jobs

| Cenário | Comprovantes únicos | POST HTTP (com retries e falhas) | GET HTTP comandos reais | Duplicatas idempotentes | Falhas HTTP injetadas | ACK por TV | WAL PG17 gerado |
|---|---:|---:|---:|---:|---:|---:|---:|
| 24h · 100 TVs | 28.800 | 1.304 | 400 | 5.050 | 301 | 288 | 14.212.288 B |
| 24h · 300 TVs | 86.400 | 3.904 | 1.200 | 15.050 | 901 | 288 | 43.153.288 B |
| 7d · 100 TVs | 67.200 | 1.804 | 400 | 5.050 | 301 | 672 | 33.264.912 B |
| 7d · 300 TVs | 201.600 | 5.404 | 1.200 | 15.050 | 901 | 672 | 99.671.512 B |

As falhas HTTP são **esperadas/injetadas**, não erros de job CI: dois intervalos de indisponibilidade por dispositivo, uma resposta ACK perdida por dispositivo e uma falha no banco em uma TV. Os testes verificaram após reenvio que nenhum ACK foi avançado indevidamente e nenhuma prova foi duplicada.

### Espaço físico SQL, índices e fila SQLite no laboratório

| Cenário | Histórico PG com índices | Apenas índices PG | CQRS diário com índices | Tamanho do banco PG | SQLite local somado |
|---|---:|---:|---:|---:|---:|
| 24h · 100 | 9,060 MB | 3,154 MB | 49.152 B | 17,143 MB | 14,794 MB |
| 24h · 300 | 26,354 MB | 9,413 MB | 114.688 B | 34,699 MB | 44,383 MB |
| 7d · 100 | 21,709 MB | 8,061 MB | 139.264 B | 29,931 MB | 22,603 MB |
| 7d · 300 | 63,177 MB | 23,986 MB | 286.720 B | 71,702 MB | 67,810 MB |

MB decimais. Banco PG inclui estruturas de sistema e esquema QA. WAL é gerado pela atividade de escrita medida via `pg_wal_lsn_diff()`, **não** o espaço ocupado por arquivos WAL ao final. O tamanho SQLite representa a soma de arquivos locais de todas as TVs simuladas, incluindo páginas e WAL; **não** inclui mídia, Storage, CDN ou backups.

**Índice ainda ocupa espaço:** batching/CQRS **não apagam índices**. O crescimento da tabela e dos índices foi medido, e permanece necessário testar arquivamento seguro, segmentos e retenção sem perda, em etapas futuras.

### Projeção: atraso, recuperação e integridade

| Cenário | Maior backlog por dispositivo ao projetar | Tempo acumulado de catch-up SQL | P95 HTTP |
|---|---:|---:|---:|
| 24h · 100 | 58 eventos | 3,333 s | 101,918 ms |
| 24h · 300 | 58 eventos | 7,398 s | 77,114 ms |
| 7d · 100 | 135 eventos | 3,532 s | 108,426 ms |
| 7d · 300 | 135 eventos | 5,284 s | 57,060 ms |

O backlog é o máximo observado em **número de eventos ainda não resumidos por TV** nas cinco fases virtuais. Tempo de catch-up é o tempo total das rodadas do projetor no runner, **não um atraso de 5 segundos sustentado por sete dias reais**. Sem prova de latência em carga contínua. P95 inclui chamadas HTTP de QA locais e pode variar por runner; não é SLA de rede pública.

### Quotas e limites de armazenamento

- Quota local configurada `MAX_LOCAL_PENDING=50000`. O ensaio específico reduz temporariamente o limite para **5**, grava cinco comprovantes, tenta o sexto e exige rejeição sem apagar a fila; após reabrir SQLite, cinco provas ainda estão lá. **PASS** para a verificação de aplicação na fila de teste.
- O teste principal nunca chega à quota de 50.000 por dispositivo. Na operação a cada 15s, sete dias implicariam 40.320 provas, portanto a margem teórica é de 9.680 por TV, **não reserva comprovada em disco Android**.
- `PG_QUOTA_BYTES=268435456` (256 MiB) é **apenas gate de verificação ao final**: o maior PG ficou em 71,702 MB. **Não é enforcement de cota de PostgreSQL, não simula disco cheio e não é limite contratado Supabase.** Precisa de quota transacional/política de alerta para produção, além de armazenamento de histórico/backup.
- Não houve falta de espaço física, corte de energia em TV Box, corrupção eMMC, queda de rede real, TLS/JWT/RLS reais ou migração de backend. As falhas foram injetadas pelo código QA.

## Comandos por revisão versus polling constante

**Diferenciar duas medidas:**
1. **GETs HTTP executados**: 4 por TV (inicial, duas alterações de revisão e validação de fallback) → 400 para 100 TVs, 1.200 para 300 TVs. `WebSocket=0`; nenhum serviço FCM real ou push instalado.
2. **Volume de consultas programadas ao longo do período virtual (modelo matemático, NÃO HTTP executado):**
   - polling a cada **2 minutos**;
   - revisão+fallback a cada **15 minutos**, mais duas alterações notificadas (duas consultas adicionais).
   
| Período / TVs | Polling 2min, GETs virtuais | Revisão + fallback 15min, GETs virtuais | Redução virtual |
|---|---:|---:|---:|
| 24h / 100 | 72.000 | 9.800 | 86,39% |
| 24h / 300 | 216.000 | 29.400 | 86,39% |
| 7d / 100 | 504.000 | 67.400 | 86,63% |
| 7d / 300 | 1.512.000 | 202.200 | 86,63% |

**Cuidado:** mensagens push têm custo e podem não chegar a TV Box sem serviços Google; consulta de fallback ainda é necessária. Heartbeats e notificações de OFF/ON são outro canal, **não estão nessas contagens**. CQRS economiza consultas de leitura do painel, não elimina o volume físico de recibos do banco.

## Histórico de correções da própria suíte

- [Run 41243348109](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41243348109): FAIL por sintaxe `LIKE '%'` interpretada pelo `psycopg` como substituição de parâmetro; corrigido para `LIKE %s` com parâmetro explícito.
- [Run 41243422883](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41243422883): cenários 24h já PASS, mas sete dias FAIL em uma asserção do próprio calendário virtual: a primeira sincronização ocorria em novembro, deixando outubro vazio. Criado checkpoint no primeiro dia de outubro e mantida atribuição por recebimento, sem alterar prova/horário.
- [Run 41243514442](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41243514442): **quatro jobs success**. Nenhuma dessas correções modificou código usado pelas TVs, banco oficial ou funções implantadas.

## Decisão técnica

**PASS**: protocolo real de QA funciona no ritmo sintético definido, com ACK seguro, SQLite persistente, recuperação de dois períodos offline, deduplicação após ACK perdido, quota local de teste, projeção diária idempotente, comparação de comandos por revisão e medição objetiva de WAL e índices.

**NO-GO para capacidade comercial de 300 TVs × 7 dias a cada 15s:** esse cenário representaria 12.096.000 comprovantes, 60× o maior ensaio. É necessário novo teste de carga realista em ambiente descartável de maior capacidade, medindo throughput sustentado, recursos, IOPS, armazenamento e custo. Não extrapolar os 71,7 MB ou os 99,7 MB de WAL como previsão dessa carga completa.

### Próximo gate sem produção

1. **Carga realista de 15 segundos** em 24h/7 dias virtuais, com linhas equivalentes à escala integral; distribuir jobs por shard, evitar runner pequeno e validar limite explícito de espaço do QA (sem credenciais reais).
2. Simular quedas prolongadas até atingir **50.000 recibos locais**, falha real `SQLITE_FULL` e retomada sem perder eventos.
3. Comparar `EXPLAIN ANALYZE BUFFERS` de consultas do painel contra CQRS em milhões de linhas, e medir atraso de projeção e compactação segura com arquivo externo verificado.
4. Testar controle de revisão/push com TV Box de **homologação**, TLS, temporização, boot 1970 e reconexão; não assumir garantia de entrega.
5. Autorizar integração Android/Gateway/Supabase **somente depois** da homologação completa e rollback, em uma mudança isolada. Nenhum deploy ou DELETE foi autorizado.

**Proteções:** não alterar `main`, Supabase V1/V2, Vercel, APK, painel ou TVs; somente branch QA e GitHub Actions.
