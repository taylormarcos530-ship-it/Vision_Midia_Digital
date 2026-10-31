# Vision V2 — capacidade progressiva de UM PostgreSQL 17 com 12.096.000 provas + HTTP 100/300 clientes

**Data:** 31/10/2026. **Escopo:** branch isolada `experiment/vision-v2-sequence-watermark-qa-20261031`; banco PostgreSQL 17 descartável `vision_v2_quarantine_disposable`, nunca Supabase oficial. **Resultado final: PASS nos quatro checkpoints e nos testes HTTP 100/300. NO-GO para produção.**

## Evidências diretas do GitHub

- [Workflow final run 41246851930](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41246851930), commit testado `6138909cf5ada634fc76de77faf812b572060b41`, `conclusion: success`.
- [Piloto 1 milhão + 100/300 HTTP, run 41246765408](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41246765408), `success`. Liberou aumento da carga após comprovar HTTP.
- [Código da suíte](../../tests/vision-v2-sequence-qa/single-db-capacity-qa/single_db.py); [workflow estritamente QA](../../.github/workflows/vision-v2-single-db-capacity-qa.yml).
- Histórico transparente: [run 41246635135](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41246635135) falhou antes da ingestão por SQL parametrizado sem escapar o operador `%`; [run 41246686093](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41246686093) validou 1 milhão, mas falhou na amostragem de bloqueios por conexão já fechada. Correções **apenas no código de QA**; runs finais aprovados.

## Carga realmente executada, sem extrapolação

- **Uma única instância PostgreSQL 17** mantida durante todo o job, 300 identidades de dispositivos, 30 empresas sintéticas, sequência por dispositivo, 2 partições mensais de recebimento e CQRS diário. Dados sintéticos, hashes SHA-256 por evento usando `pgcrypto`; `played_at=NULL`, `billable=false`.
- **Quatro checkpoints cumulativos**, no **mesmo banco**, com `INSERT INTO ... SELECT generate_series(...)` em transações SQL de **100.000 eventos** para acelerar o ensaio de capacidade. **Não foram 12 milhões de requisições HTTP nem 242.000 transações HTTP**. Esse caminho mede tamanho/index/WAL/processamento SQL, e não a latência real do player/gateway.
- Cada checkpoint projetou o backlog novo no CQRS com cursor transacional e verificou total do histórico = total dos resumos e ausência de provas faturáveis ou datadas artificialmente.
- **Depois dos 12.096.000 eventos**, um gateway HTTP real via `127.0.0.1` usou `ThreadingHTTPServer` com duas rodadas de **100 e 300 clientes simultâneos**, lotes de 50, autenticação com tokens apenas fictícios, sequência/watermark sob lock por dispositivo, transação idempotente, rollback injetado, perda simulada de ACK, tentativa de token inválido e replay histórico.
- O gateway limitou o ingresso simultâneo no PostgreSQL a **16 permissões** por semáforo. Isso mede concorrência HTTP com fila no servidor, **não 300 transações PostgreSQL executadas exatamente ao mesmo tempo**. Não foram usadas API Supabase, RLS/JWT reais, TLS, internet celular, TV Box, comandos FCM, CDN, mídia ou Vercel.
- Após os testes HTTP, **12.111.000 comprovantes** no banco: 12.096.000 de carga + 5.000 novos na rodada 100 + 10.000 novos na rodada 300. Na segunda rodada, os primeiros 100 dispositivos repetiram o batch anterior e não criaram novos eventos.
- Dados originais não foram excluídos; sem DELETE, TTL ou migrations em produção.

## Métricas cumulativas de cada checkpoint — logs reais

| Comprovantes no banco único | Banco total (bytes) | Histórico com índices (bytes) | Apenas índices (bytes) | WAL gerado (bytes) | CQRS (bytes) | Autovacuum acumulado |
|---:|---:|---:|---:|---:|---:|---:|
| 1.000.000 | 318.723.763 | 310.214.656 | 119.619.584 | 488.283.968 | 106.496 | 0 |
| 3.000.000 | 939.333.299 | 930.586.624 | 358.825.984 | 1.480.966.680 | 172.032 | 3 |
| 6.000.000 | 1.872.492.211 | 1.863.622.656 | 720.191.488 | 2.969.809.384 | 286.720 | 3 |
| 12.096.000 | 3.769.710.259 | 3.760.726.016 | 1.455.603.712 | 6.003.924.016 | 352.256 | 8 |
| **Final após HTTP, 12.111.000** | **3.774.944.947** | **3.765.944.320** | **1.457.569.792** | **6.013.215.248** | **368.640** | **8** |

Unidades exibidas em bytes; MB/GB decimal em apresentações. O WAL é **gerado acumulado pela carga via diferença LSN**, e não bytes de arquivos WAL armazenados nem volume cobrado pela plataforma. `pg_database_size` inclui outras estruturas do banco descartável; relatório não extrapola para Supabase Free, que tem índices, RLS, Edge Functions e política de quotas diferentes.

### Escrita e atualização das projeções CQRS

| Marco | Maior backlog por dispositivo antes da projeção | Tempo observado de atualização |
|---:|---:|---:|
| 1 milhão | 3.334 eventos | 0,933 s |
| 3 milhões | 6.667 eventos | 0,800 s |
| 6 milhões | 10.000 eventos | 1,485 s |
| 12,096 milhões | 20.320 eventos | 2,490 s |
| Lotes HTTP adicionais | 50 eventos | 1,559 s |

- A medição é de **uma rodada em banco local**, não tempo garantido por sete dias nem lag sustentado sob ingestão contínua. Não se mediu p95 da projeção; cada atualização foi única por marco.
- O estado CQRS usa uma linha por dispositivo/dia de recepção. Isso reduz a leitura do painel mas **não elimina os recibos originais** nem diminui seus índices.
- Os 12,096 milhões de provas representam a cadência completa de 15 segundos em sete dias para 300 TVs; porém foram inseridos rapidamente em lote e sem a rede real nem os dispositivos físicos.

## HTTP local concorrente — dados reais

| Métrica | 100 clientes | 300 clientes |
|---|---:|---:|
| Clientes que concluíram | 100/100, PASS | 300/300, PASS |
| Requisições POST observadas (inclui 1 replay de verificação + 1 token inválido) | 104 | 303 |
| Erros HTTP esperados e tratados | 2 | 1 |
| Novos recibos da rodada | 5.000 | 10.000 |
| Replays reconhecidos | 100 | 5.100 |
| P95 de latência HTTP local | **344,243 ms** | **1.732,477 ms** |
| Duração da rodada | **0,97 s** | **2,96 s** |
| Lote máximo | 50 | 50 |
| Permissões simultâneas de acesso SQL no gateway | 16 | 16 |
| Aguardando lock PostgreSQL no instante amostrado | 0 | 0 |

O cenário 300 concorrentes teve P95 substancialmente pior; isso **não é garantia de qualidade do serviço real**. Os testes foram de loopback no mesmo runner e banco. Requer medir picos reais, timeouts, concorrência de longa duração e recursos do Supabase isoladamente antes de qualquer decisão.

## Memória, locks, deadlocks, autovacuum

- `pg_stat_all_tables`: autovacuum acumulado **0 → 3 → 3 → 8** nos marcos, sem VACUUM manual. A amostra final estimou `n_dead_tup=1.823`, valor aproximado de estatística PostgreSQL.
- `pg_stat_database.deadlocks=0`; `pg_stat_activity` não mostrou esperas por locks nas amostras. **Não existiu coleta contínua dos picos de lock** e 16 acessos SQL foram delimitados por semáforo; não concluir ausência geral de contenção.
- Memória da sessão PostgreSQL de instrumentação via `pg_backend_memory_contexts`: cerca de **3,09 MB**, que **não mede RSS total de todos os processos PostgreSQL**. `ru_maxrss` do processo Python: aproximadamente **83.740 KiB** depois do HTTP; **não é RAM total do banco/contêiner**.
- O ensaio não executou `pg_stat_statements` do banco de produção, profiling CPU por query, teste de OOM, saturação de IOPS, cache sob reinício nem WAL retido. Essas medições precisam de instrumentação adicional em outro ciclo de QA.

## Limites e segurança

| Proteção do QA | Configuração | Resultado |
|---|---|---|
| PostgreSQL obrigatório | exato `vision_v2_quarantine_disposable`, versão 17 | PASS |
| Disco livre mínimo no host | 4 GiB | PASS (88,65 GB livres ao final) |
| Limite preventivo do banco | 5 GiB | PASS (3,775 GB) |
| Limite preventivo de WAL gerado | 12 GiB | PASS (6,013 GB) |
| Limite de tempo lógico da carga | 1.350 s | PASS (marco de 12M em ~155 s no runner) |
| Workflow GitHub | timeout 30 minutos | PASS |
| Isolamento | branch experimental; contêiner local; checkout sem credenciais persistidas | PASS |

Os limites foram guardas preventivas de QA, com estimativa antes do próximo bloco; **não foi provocado disco cheio**, nem comprovado que uma instância com recursos/cotas de Supabase Free suportaria 3,775 GB de banco. O banco e a memória foram do runner do GitHub, não de conta do usuário.

## Decisão e próximos gates

**PASS** para capacidade de **até 12.096.000 linhas em um único PostgreSQL17 descartável** com o esquema artificial testado, expansão incremental, WAL/index/CQRS instrumentados e HTTP local com 100/300 clientes concorrentes em rodadas curtas, mantendo integridade e ACK.

**NO-GO para produção**, especialmente Supabase Free, 300 TVs reais e esquema oficial. Antes de qualquer publicação, são necessários testes:
1. 300 clientes por horas simuladas com rajadas e rede instável, conexão JWT/RLS reais em ambiente QA, p95/p99, limite de Edge Functions e 5xx; ainda **sem tocar no Supabase oficial**.
2. Comparar esquema real do histórico e índices com o esquema sintético usando leitura do GitHub e do Supabase **somente se autorizado**. Não migrar, não criar novos índices ou partições em produção.
3. Testar limpeza/retention segura vinculada à criptografia/manifesto de arquivo remoto e replay idempotente, sem excluir originais antes de autorização explícita.
4. Controlar quota e custo de GB de banco, WAL, Storage de mídia e requisições de heartbeat, comandos, monitoramento. O gateway atual e o player não foram integrados.
5. Testar carga após reinício real de PostgreSQL e recuperação de conexão HTTP, quotas de SQLite e boot com relógio 1970 em Android descartável de homologação.

**Produção preservada:** nada alterado em `main`, Supabase, APK, Vercel, painel, site, TVs, usuários ou registros de anunciantes.
