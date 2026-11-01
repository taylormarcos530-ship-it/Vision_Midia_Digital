# Vision V2 — 100/300 consultas HTTP concorrentes, CQRS compacto, AES-GCM, TTL/quota por empresa

**Data do CI:** 01/11/2026 UTC. **Branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Decisão:** PASS do experimento isolado, **NO-GO para produção** em razão de P99, fila, ausência de KMS e falta de economia líquida comprovada. Nenhum SQL executado no Supabase oficial.

## Evidência real de CI

- [Run definitivo 41260447254](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41260447254), `conclusion=success`, HEAD do código testado `3d59f971dda10c92971f05cf14a7bfa591393908`. Dois jobs **success**: produtor de arquivo criptografado (job 124712428086) e consumidor HTTP/PG17 concorrente (job 124712520328).
- [Workflow em branch isolada](../../.github/workflows/vision-v2-concurrent-ondemand-qa.yml) e [teste Python integral](../../tests/vision-v2-sequence-qa/concurrent-ondemand-qa/benchmark.py).
- Primeira tentativa [run 41260322303](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41260322303): **Runner A PASS / Runner B FAIL** por `NameError: psycopg is not defined` no próprio teste de RLS, não por erro da política do PostgreSQL. Corrigido com import na branch de QA, commit `3d59f971dda10c92971f05cf14a7bfa591393908`. Não alterou dados ou código de produção.
- Execução paralela independente já existente na mesma branch, [run 41260274457](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41260274457), também **PASS**, 800 consultas HTTP, pior P99 de **16,391 s**. Não misturar as métricas dos dois jobs: são benchmarks distintos.

## Metodologia de nossa execução final

- **Runner A:** usa produtor sintético já testado; mantém 664 eventos comerciais **originais** num PostgreSQL 17 descartável, 276 resumos diários em `qa_rpc.daily`, nenhuma segunda cópia **permanente** por evento. Produz 10 objetos AES-256-GCM com SHA-256 de ciphertext e plaintext por segmento, agrupados por empresa e dia, além de manifesto, referência JSON dos RPCs originais e chave AES **apenas de teste**.
- **Runner B:** novo PostgreSQL 17 descartável em outro job. Reconstrói os 664 originais sintéticos no seu banco de QA, mantém os 276 resumos e não materializa segunda tabela permanente de eventos. Arquivos da etapa A trafegam como artefatos GitHub Actions entre jobs independentes. O storage de QA é um servidor HTTP loopback no runner B, não S3/CDN/rede pública.
- A API HTTP local recebe `POST /qa/report` com case ID, request ID e **JWT HS256 sintético**. Verifica assinatura, issuer, expiração, usuário e empresa **antes** de selecionar objetos. Os segmentos AES-GCM são validados por SHA-256, AAD e tag. O gateway recupera os eventos apenas da empresa/dias da consulta e monta tabela **SQL TEMPORÁRIA por conexão**. Executa os RPCs derivados de SQL original `get_playback_report` e `get_playback_events`, compara o JSON integral e todas as linhas da exportação a uma referência previamente obtida do RPC original. **Só responde com `verified=true` e reconhece ACK de consulta após a paridade.**
- A resposta HTTP de teste envia **o hash SHA-256 e métricas**, não o JSON completo, embora o servidor valide o JSON integral antes da resposta. Isso reduz artificialmente o egress HTTP do teste; a quantidade `validated_result_bytes` registra o tamanho do JSON validado, útil para projetar **o que seria transferido se o JSON completo fosse enviado**, mas **não é byte-count de rede real**.
- **Cache:** LRU com singleflight por segmento, segmentado por UUID de empresa, **quota 110.000 bytes por empresa** e TTL 10 s nas rodadas normais, além de teste explícito TTL 80 ms. A quota e TTL se aplicam a payloads decifrados mantidos em RAM, não à mídia do player nem ao cache do navegador. A troca de empresa no JWT não permite ler cache de outra empresa.
- **Backpressure:** semáforo com **12 conexões SQL simultâneas no máximo**, fila com timeout máximo de 40 s. 100 e 300 requisições iniciadas em paralelo em duas rodadas cada, com cache “frio” (clear) e “quente”. Teste do RPC também exige RLS ativo em PostgreSQL e rejeita membership cruzado.
- **Falhas negativas:** JWT cruzado, expirado ou assinado incorretamente; seleção de cache de outra empresa; GET externo com falha 503; arquivo alterado; chave errada; cache expirado e buscado novamente; recuperação depois de restabelecer objeto. Solicitação 503 não gera confirmação de consulta. Nenhum dado é apagado.

## Resultados reais: HTTP concorrente e latência

Cada consulta executa **o relatório inteiro e sua exportação** no PostgreSQL local usando uma tabela TEMP e compara resultado completo, mas retorna apenas digest e contadores ao cliente.

| Carga simultânea | P95 HTTP | P99 HTTP | Tempo da rodada | GETs de segmento na rodada | Cache hits | Cache misses | Evictions |
|---|---:|---:|---:|---:|---:|---:|---:|
| 100, frio | 4.280,848 ms | 4.413,850 ms | 4,736 s | 28 | 248 | 28 | 21 |
| 100, quente | 4.319,358 ms | 4.378,783 ms | 4,640 s | 25 | 251 | 25 | 25 |
| 300, frio | 12.904,032 ms | 13.679,446 ms | 14,342 s | 69 | 767 | 69 | 63 |
| 300, quente | 12.806,507 ms | 13.448,818 ms | 14,093 s | 69 | 767 | 69 | 65 |

**PASS** significa 800/800 consultas da matriz terminadas com JSON + exportação íntegros, além das verificações negativas. Não significa desempenho aceitável para produção.

A série **quente não eliminou os GETs** porque a quota de 110 KB por empresa força substituição de objetos durante as diferentes consultas. No teste anterior sem quota foi possível não fazer novos GETs; aqui esse comportamento não se repete sob limite. **Não afirmar que cache quente elimina requisições externas neste desenho.**

### Resultado consolidado dos contadores

| Medição do Runner B | Valor real |
|---|---:|
| Solicitações POST totais, inclusive negativas | **811** |
| Respostas HTTP 200 com JSON/export comprovados, incluindo controles | **806** |
| Respostas esperadas 401/409/503 | **5** |
| GETs HTTP aos objetos, incluindo negativas | **200** |
| Cache hits | **2.034** |
| Cache misses verificadas | **196** |
| Cache evictions | **174** |
| Expirações por TTL | **5** |
| Falhas simuladas de obtenção de objeto | **4 tentativas** |
| Retries internos de GET | **2** |
| Bytes baixados de objetos, excluindo GETs sem resposta útil | **6.660.644 B** |
| Maior cache agregado amostrado | **186.927 B**, abaixo de **220.000 B** (2 empresas × 110 KB) |
| Cache final | 80.381 B por empresa, total 160.762 B |
| SQL em paralelo (máximo) | **12** |
| Esperando permissão de SQL (máximo) | **283** |
| Estouro do timeout de backpressure | **0** |
| Deadlocks `pg_stat_database` | **0** |
| Waiters `pg_stat_activity` no fim | **0** (amostra pontual, não pico) |
| RSS máximo processo Python CI | **149.016 KiB**, ~145,5 MiB |

**Atenção:** 283 são solicitações aguardando **semáforo do gateway**, não necessariamente sessões esperando **lock no PostgreSQL**. A RAM é do processo Python principal, não memória total do serviço PostgreSQL, contêiner ou Supabase. O cenário é short-burst, não seven-day soak. O HTTP de objetos e API é **loopback**, não rede real.

## Armazenamento e custos estimados

| Componente | Bytes observados no runner B |
|---|---:|
| Banco PostgreSQL, com todos os eventos originais e resumo diário | **13.588.147** |
| Índices do histórico original (parte do banco) | **335.872** |
| Índices do CQRS diário (parte do banco) | **16.384** |
| 10 segmentos criptografados externos | **346.020** |
| Manifesto de segmentos | **3.781** |
| Arquivo de referência JSON dos testes | **4.196.959** |
| Chave AES sintética em artefato próprio | **32** |
| **Total bruto incluindo referência de QA + chave (sem dupla contagem de índices)** | **18.134.939** |

Os índices estão **incluídos** no valor do banco, não devem ser somados novamente. A referência JSON de 4,197 MB é exclusivamente teste, não obrigação do produto. Os 346 KB cifrados adicionam espaço externo; **os 664 eventos originais não são removidos**. O desenho evita uma segunda tabela permanente evento-a-evento, mas **não demonstra economia líquida de espaço**. A tabela TEMP requer recursos transitórios em disco/memória; medições variam por job. O banco pequeno e sintético não representa 300 TVs × sete dias nem limites reais do Supabase.

### Cenário financeiro hipotético, NÃO tabela Supabase nem preço verificado

| Premissa ilustrativa | Cálculo/resultado para esta pequena QA |
|---|---:|
| Banco: US$ 0,125/GB-mês (suposição) | ~US$ **0,00169852/mês** para 13,59 MB |
| Arquivo externo: US$ 0,023/GB-mês (suposição) | ~US$ **0,00000796/mês** para 346 KB |
| GET: US$ 0,0004/1.000 (suposição) | ~US$ **0,00008** para 200 GETs |
| Egress: US$ 0,09/GB (suposição) | ~US$ **0,00614** se ~68,26 MB de JSON completo fossem enviados; **não medição de egress HTTP real** |

Esses números são apenas **modelo de comparação** com taxas hipotéticas e **não incluem plano, egress Supabase, limites de Edge Functions, mídia/CDN, backup, conexões, impostos ou taxa do dólar**. **Não extrapolar custos a 300 TVs** a partir deste benchmark de 664 eventos sintéticos.

## GO/NO-GO e próximos gates

**PASS:** integridade de 800 consultas HTTP concorrentes, arquivo AES-GCM, RLS/JWT sintéticos, paridade integral dos dois RPCs derivados do SQL original, quota/TTL por empresa, backpressure sem timeout, falha de objeto/chave e recuperação. Todos os originais preservados.

**GO somente para próxima rodada de homologação isolada. NO-GO para produção**, pelos motivos verificáveis: 300 clientes com P99 ~13,7 segundos; pico de 283 na fila do gateway; cache de quota pequena reinicia GETs mesmo no cenário quente; custo de CPU/RAM de gerar SQL TEMP + JSON por consulta; custo externo adiciona bytes enquanto originais são preservados; ausência de KMS e manifesto com assinatura independente; sem SLA real em Supabase ou TV Box.

**Próximo passo experimental recomendado:** medir cache de **resultados agregados do painel** por empresa/filtro/versão da programação, com invalidação revisional, em vez de remontar eventos e JSON completo por consulta; comparar TTL/quotas de 110KB, 512KB e 2MB; distinguir acesso a relatórios raros de comandos dos players (que devem usar revisão + polling com fallback), reduzindo backpressure e GETs. Validar todos os resultados com o RPC original, segurança por empresa e logs antes de qualquer deploy. Nenhum histórico real ou índice será excluído.
