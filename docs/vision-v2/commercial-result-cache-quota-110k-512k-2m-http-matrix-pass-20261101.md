# Vision V2 — Cache de RESULTADOS comerciais por tenant/filtro/revisão, matriz 110KB/512KB/2MB, 100/300 HTTP

**Data da execução:** 01/11/2026 UTC. **Branch experimental isolada:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Veredito:** **PASS funcional** no GitHub Actions PG17 descartável; **GO para continuar somente QA; NO-GO para produção**.

## Provas GitHub Actions e rastreabilidade

- [Run definitivo 41264648418](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41264648418), **conclusion=success**, HEAD testado `79287c86d0cded241f7cdc6a36a90d625ebc713b`; Runner A (artefatos sintéticos) **PASS** e Runner B (12 cenários concorrentes) **PASS**. Nos logs: `QA_RESULT_CACHE_MATRIX_PASS=true`.
- [Código exato do benchmark](../../tests/vision-v2-sequence-qa/result-cache-matrix-qa/benchmark.py), [workflow do teste, permissions: contents:read e sem deploy](../../.github/workflows/vision-v2-result-cache-matrix-qa.yml).
- Primeiro run [41264550607](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41264550607) com Runner A **PASS** e Runner B **FAIL**. O arquivo adulterado foi rejeitado, mas o gateway experimental mapeava `ValueError` de integridade para HTTP 409; deveria responder **503**, sem ACK. Corrigido em `79287c86...` apenas no script de QA. A execução final **2/2 PASS**.
- Comparação histórica com [run anterior 41260447254](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41260447254), que usava **cache de SEGMENTOS**, com P99 frio 13,679 s e quente 13,449 s com 300 clientes. **São testes de cache e cargas diferentes; não atribuir a razão numérica da latência apenas à mudança de cache.**
- Nenhuma execução SQL no Supabase oficial, nenhum deploy, APK, site, painel ou TV tocados; sem exclusão de comprovantes reais ou sintéticos de origem. O workflow de QA usa dois PostgreSQL17 descartáveis em runners diferentes.

## O que foi realmente implementado na bancada

- **Fonte:** 664 eventos comerciais **sintéticos imutados** em `public.playback_logs`, mais 276 grupos de CQRS diário. **Não existe segundo read model permanente por evento.** Os eventos detalhados para o RPC são reconstruídos em tabela TEMP por conexão apenas nos misses.
- **Arquivo externo:** 10 segmentos AES-256-GCM agrupados por empresa e dia, com SHA-256, manifesto e referência do **JSON do RPC original** extraídos num runner A e transferidos ao runner B como artefatos. A chave é **100% sintética e trafega em outro artefato GitHub de retenção 1 dia — NÃO é KMS seguro de produção.** Object-store é HTTP loopback local no runner, não CDN/S3/Supabase.
- **Cache de RESULTADOS:** armazena em **RAM** os bytes canônicos do JSON **completo do relatório + exportação**, após conferir igualdade por hash com a referência do RPC original. Chave inclui `(empresa, início, fim, campanha, TV, revisão)`. GET exige verificar JWT HS256 sintético e empresa do usuário **antes** de qualquer consulta ao cache.
- Cache LRU e TTL **90 segundos** em carga; testes adicionais com TTL forçado de **50 ms** e confirmação de expiração/atualização. Quotas **por empresa** de **110.000 / 512.000 / 2.000.000 bytes**. Resultado maior que quota não é cacheado. *Singleflight* serializa pedidos repetidos de mesma chave; semáforo controla até **12 transações SQL simultâneas**; tempo máximo na fila 45 s.
- **Invalidação por revisão:** `qa_cache_revision` existe somente em PG17 descartável, começa em 1, e um `UPDATE version=version+1` foi confirmado antes de invalidar cache da empresa A. O teste verifica que o próximo pedido retorna revisão 2 e **faz miss**, nunca reutilizando rev.1. **A revisão não foi conectada às alterações reais de playlist/campanha/anúncio** e conteúdo não mudou; não comprova que futuras invalidações produtivas serão completas. Exige tratamento de concorrência e invalidar também sobre outros processos/instâncias.
- Falhas: JWT/tenant divergente, token expirado ou adulterado, RLS PostgreSQL por empresa e membership do RPC original, storage 503, segmento alterado, chave AES errada, restauração após reinício do acesso, **nenhum ACK de consulta** na falha, revisão e TTL.
- Limitação importante: somente o **cache de resultados** tem quota por tenant. A classe de cache auxiliar de segmentos criptografados/decifrados reutilizada do teste anterior `p.Archive` é **sem quota própria**, embora seja temporária do processo. Antes de integração real, implementar limite e política de expulsão também ali, para evitar memória crescer com o histórico.

## Matriz final PASS (logs reais, 100 e 300 clientes)

Cada cenário faz 100/300 POSTs em paralelo, executa o RPC completo **e a exportação** em caso de miss, compara o JSON completo do SQL original em ambiente PG17 descartável e responde apenas SHA e contagem de bytes de QA.

| Quota por empresa | Clientes | Fase | P95 HTTP | P99 HTTP | SQL misses (RPCs realmente reconstruídos) | GET objetos | Cache hits | Evictions |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| 110 KB | 100 | Frio | 2.311,822 ms | 2.436,443 ms | 59 | 60 | 41 | 37 |
| 110 KB | 100 | Quente | 1.895,552 ms | 2.015,712 ms | 57 | 48 | 43 | 37 |
| 110 KB | 300 | Frio | 3.674,549 ms | 3.997,078 ms | 104 | 57 | 196 | 40 |
| 110 KB | 300 | Quente | 3.565,744 ms | 4.285,846 ms | 103 | 49 | 197 | 41 |
| 512 KB | 100 | Frio | 2.023,056 ms | 2.080,711 ms | 48 | 67 | 52 | 37 |
| 512 KB | 100 | Quente | 1.319,676 ms | 1.387,877 ms | 37 | 47 | 63 | 41 |
| 512 KB | 300 | Frio | 2.026,343 ms | 2.197,911 ms | 48 | 51 | 252 | 37 |
| 512 KB | 300 | Quente | 1.607,576 ms | 1.771,914 ms | 38 | 52 | 262 | 40 |
| 2 MB | 100 | Frio | 1.824,307 ms | 1.878,365 ms | 48 | 64 | 52 | 8 |
| 2 MB | 100 | Quente | **176,804 ms** | **235,943 ms** | **8** | **11** | **92** | 7 |
| 2 MB | 300 | Frio | 1.998,561 ms | 2.138,214 ms | 48 | 61 | 252 | 11 |
| 2 MB | 300 | Quente | **388,030 ms** | **593,039 ms** | **11** | **14** | **289** | 6 |

Cada quota foi testada com 800 clientes HTTP no conjunto de quatro rodadas, além de verificações preliminares negativas e positivas. **Todas as 2.400 solicitações da matriz tiveram JSON integral e exportação corretos**. Cache frio não significa ausência de singleflight: solicitações iguais compartilham resultado calculado no mesmo burst. A tabela indica SQL misses por rodada, não `N` chamadas SQL individuais dentro do RPC.

### Contadores agregados, separando as três quotas

| Quota | HTTP totais incl. 13 checks de QA | HTTP aprovados incl. 8 checks | HTTP negativos esperados | RPCs SQL em todo teste incl. preflight | Cache hits incl. preflight | Pico cache total 2 empresas |
|---|---:|---:|---:|---:|---:|---:|
| 110 KB | 813 | 808 | 5 | 329 | 479 | 212.509 bytes |
| 512 KB | 813 | 808 | 5 | 177 | 631 | 1.015.541 bytes |
| 2 MB | 813 | 808 | 5 | 121 | 687 | 3.977.932 bytes |

As 5 negativas em cada quota correspondem a JWT cruzado/expirado/adulterado, indisponibilidade de arquivo e objeto adulterado. O teste de chave AES errada foi verificado diretamente sem POST. Cada quota teve **0 timeouts do semáforo SQL**, máximo **12 acessos SQL ativos** e espera máxima em fila no gateway de **30 / 25 / 22** respectivamente (não é espera por lock PostgreSQL).

**GETs HTTP de arquivo no total dos 12 cenários + falhas/preflight:** **599**; as somas somente das rodadas totalizam 581, a diferença corresponde aos testes de segurança. A implementação anterior com cache de segmentos teve 200 GETs num ensaio com 800 clientes, enquanto esta matriz contém três quotas e 2.400 clientes. **Comparar taxa por consulta e padrão de filtros, nunca o total bruto isolado.**

## Recursos e custos — sem inventar preço Supabase

| Medição do runner B | Valor |
|---|---:|
| Banco descartável total, incluindo histórico e resumo | **12.211.891 bytes** |
| Índices do histórico (já incluídos no banco) | **335.872 bytes** |
| Índices do CQRS diário (já incluídos no banco) | **16.384 bytes** |
| Segmentos cifrados externos | **346.020 bytes** |
| Manifesto | **3.781 bytes** |
| Referência JSON estritamente de QA | **4.196.959 bytes** |
| Chave sintética de QA | **32 bytes** |
| Soma banco + arquivo + manifesto + referência QA + chave (sem somar índices duas vezes) | **16.758.683 bytes** |
| RSS máximo do processo Python | **150.420 KiB**, ~146,9 MiB |
| Cache de resultados total máximo na quota 2 MB | **3.977.932 bytes**, ~3,98 MB para duas empresas |

A referência de 4,197 MB é um artefato para conferir os resultados e não é uma obrigação da arquitetura comercial. Os 664 originais foram mantidos; arquivos cifrados e resumo são adicionais. **Não houve economia líquida de armazenamento comprovada**, embora tenha sido evitada a segunda cópia permanente evento-a-evento.

**Custos:** o benchmark mede **bytes, requisições e memória**, não valores cobrados. Como cenário **hipotético e não uma cotação de Supabase**, se a leitura de objetos custasse **US$ 0,0004 por 1.000 GETs**, as 599 chamadas custariam US$ **0,0002396**. Esse valor **ignora egress, CPU/Edge Functions, armazenamento de backup, requisições PostgreSQL, tributos e índices do ambiente real**. Não converter em mensalidade nem extrapolar a 300 TVs com base em 664 linhas. O custo de armazenar 3,98 MB de RAM de cache e suas réplicas depende da plataforma; o runner CI não dá tabela de preço.

## Avaliação e GO/NO-GO

**PASS funcional de bancada:** 110K/512K/2M, 100 e 300 consultas concorrentes, JSON integral e exportação, JWT/RLS sintéticos, TTL, revisão, backpressure, falhas de arquivo/criptografia e recuperação, origem preservada.

**GO para continuar somente na branch experimental. NO-GO para produção**, porque: 
- Ganho medido na mesma suíte com 2 MB é promissor (P99 593ms quente com 300 consultas), mas depende do **conjunto sintético repetitivo de somente 48 filtros e 664 eventos**, e não prova capacidade de 300 TVs reais e 7 dias/12 milhões de linhas.
- A política de revisão foi simulada. **Precisará funcionar em múltiplas instâncias, notificação de invalidação e mudança real de anunciantes**; manter cache atualizado sem polling excessivo ou vazamento entre empresas.
- Memória do processo Python ~147 MiB na QA e cache auxiliar de segmentos sem quota própria. Controle por processo/instância, RSS do PostgreSQL e WAL/IOPS faltam.
- Sem Supabase Auth/JWT real, KMS, CDN, banco/serviço com limites do plano Free, testes de segurança da rede/TLS e backup externo durável. Cache hit não aciona RLS SQL, de modo que checagem criptográfica/ACL e revogação precisam ser testadas para impedir acesso de usuário revogado.
- Comparação antiga de P99 13,45 s (cache de segmentos) contra esta matriz 0,593 s (cache de JSON) **não é causal e nem SLA**, pois os cenários mudaram.
- Não remover históricos, índices, nomes históricos ou RPCs originais de produção.

**Próximo gate QA recomendado:** simular mudança de campanha e revogação real de acesso ao mesmo tempo em que 300 consultas chegam, testar invalidação distribuída sem queda de consistência e controle conjunto da memória do cache de segmentos/resultados (incluindo quotas, TTL, p99/latência após miss), além de comparar tráfego de GET com polling de revisão e sem WebSocket permanente, tudo em ambiente PG17 isolado.
