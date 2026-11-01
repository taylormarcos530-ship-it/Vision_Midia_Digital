# Vision V2 — 100/300 consultas HTTP concorrentes, CQRS diário compacto, arquivo AES e cache por empresa

**Data dos logs:** 01/11/2026 UTC. **Branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`.

**Veredito:** **PASS funcional** em PostgreSQL17 descartável e gateway HTTP loopback, 800/800 consultas completas com igualdade do RPC original. **GO somente para melhorar a arquitetura em QA; NO-GO para publicar a V2**: P99 chegou a **16,391 segundos** com 300 clientes concorrentes, fila de 284 requisições e sem prova de economia líquida de armazenamento enquanto os originais são mantidos.

## CI real e isolamento

- [GitHub Actions 41260274457](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41260274457), `conclusion=success`, código testado no commit **`84f8a78da473b2c4167b67d771ce41d86fb82918`**.
- [Script HTTP completo](../../tests/vision-v2-sequence-qa/concurrent-archive-http-qa/qa.py) e [workflow manual/push por paths na branch isolada](../../.github/workflows/vision-v2-concurrent-archive-http-qa.yml), permissões `contents: read` e sem secrets da produção.
- PostgreSQL17 em contêiner GitHub Actions local ao runner, banco **`vision_v2_quarantine_disposable`**; HMAC/JWT e AES chaves **sintéticas em memória**. Nenhum Supabase oficial foi consultado ou modificado; não houve deploy, APK, site, painel, TV, exclusão de comprovantes ou merge em `main`.
- Fonte da lógica comercial: [`get_playback_report` original](../../supabase/migrations/20260908025620_add_playback_report_rpc.sql) e [`get_playback_events` original](../../supabase/migrations/20260908025854_add_playback_export_rpc.sql), carregados no PG17 QA via script `compact.py` existente. RPCs para tabelas temporárias derivam só o nome do RPC e nome da tabela fonte, preservando a lógica do SQL original; **não são o Supabase hospedado**.
- Experimento de arquivo cifrado independente [CI anterior 41257396715](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41257396715) validou o transporte entre dois runners. **Nesta execução concorrente houve apenas um runner** com PostgreSQL17, gateway HTTP e servidor de arquivos HTTP loopback. Não confundir os escopos.

## Método realmente executado

- Dados totalmente sintéticos: **664 comprovantes comerciais originais, preservados**, **276 agregados diários** e nenhum `qa_rpc.read_events` permanente. A consulta de relatório monta registros individuais sob demanda em **TEMP TABLE por conexão**, sem persistir cópia adicional do histórico. Comprovantes sem horário permanecem não faturáveis; o resumo diário não substitui sozinho toda a exportação.
- Arquivo externo de bancada: **10 segmentos AES-256-GCM**, contendo datas e empresas separadas, manifesto SHA-256, decifrados somente após verificar integridade. Objetos servidos por HTTP local da mesma máquina do job. Em produção seriam necessários serviço externo durável, KMS e manifesto assinado.
- Gateway HTTP `POST /qa/report` devolve a saída **completa** de `get_playback_report` ou `get_playback_events`, **não apenas hash**. Em cada resposta, verifica igualdade integral do JSON com baseline gerado pelo RPC original do banco descartável; o cliente verifica o conteúdo outra vez. Sem informação de clientes reais ou mídia.
- **Duas rodadas de 100 clientes simultâneos e duas de 300 clientes**, total **800 requisições válidas concluídas**. As rodadas são sequenciais; não foram 400 clientes ao mesmo tempo. O servidor limita transações SQL paralelas a **12** e fila de entrada a **320**. Foi medido o maior número de solicitações esperando e conexões efetivamente executadas.
- **Cache por empresa** com TTL de **30 segundos** e quota de **256.000 bytes por empresa**, implementação LRU com proteção contra misses duplicados simultâneos. Testes negativos separados comprovaram expiração com TTL artificial de 0,1 segundo e recusa de armazenar um segmento maior que a quota artificial de 256 bytes. O benchmark normal não precisou expulsar itens: nenhum eviction.
- Autenticação com JWT sintético HMAC (sem Supabase Auth), `SET LOCAL ROLE authenticated`, execução do RPC original com associação sintética `private.is_company_member` e RLS efetivamente ativada sobre `qa_rpc.daily`. O gateway impede token de empresa A de obter dados de B e filtra os segmentos antes de descriptografar; a TEMP table não tem RLS própria, depende do servidor e da membership do RPC.
- Negativos isolados: JWT vencido e assinatura falsificada bloqueados, tentativa de trocar empresa bloqueada, acesso direto a outro segmento no cache bloqueado, arquivo adulterado rejeitado, chave incorreta rejeitada, erro de rede HTTP 503 no object-store recuperado pelo retry, TTL e quota verificadas.
- Os 800 clientes de estresse terminaram sem retries, todos com respostas iguais à baseline; **isso não comprova recuperação sob uma queda prolongada com 300 clientes** — as falhas de rede foram injetadas em testes específicos, antes das quatro ondas.

## P95 / P99 medidos nos logs

| Concorrência / rodada | Respostas completas | Duração total | P95 HTTP ponta a ponta | P99 HTTP ponta a ponta | Retentativas |
|---|---:|---:|---:|---:|---:|
| 100 clientes, primeira | 100 | 4,97 s | 4.644,733 ms | 4.765,186 ms | 0 |
| 100 clientes, segunda | 100 | 4,84 s | 4.553,292 ms | 4.632,820 ms | 0 |
| 300 clientes, primeira | 300 | 14,72 s | 13.605,637 ms | 14.160,145 ms | 0 |
| 300 clientes, segunda | 300 | 17,00 s | 15.709,035 ms | **16.391,111 ms** | 0 |

Esses valores incluem a espera na fila, o carregamento HTTP de segmentos, AES-GCM, conversão de eventos para TEMP SQL, processamento do RPC e transmissão do JSON em localhost. São **latências elevadas** para um relatório interativo; mais testes de arquitetura e instrumentação são necessários. Não são medições das TVs, heartbeat, CDN, internet pública ou Supabase Free.

### Requisições, cache, memória e backpressure

| Métrica do run | Observado |
|---|---:|
| HTTP do gateway, incluindo 4 negativas | **804 POST** |
| HTTP do gateway rejeitados pela segurança/entrada | **3 por contador de rejeições + 1 bad index** |
| Gateway 5xx durante estresse | **0** |
| POST válidos concluídos | **800** |
| Solicitações aguardando SQL, pico | **284** |
| Operações SQL simultâneas, máximo | **12** |
| Respostas HTTP devolvidas (somadas) | **34.665.081 bytes** |
| Bytes de requisições HTTP entrantes | **245.049 bytes** |
| GETs totais no object-store local | **28** |
| GETs do object-store que deram 503 intencional | **1** |
| Bytes de objeto transferidos no HTTP local | **701.602 bytes** |
| Cache de segmentos — hits / misses | **2.226 / 21** |
| Cache de segmentos — expirações | **10** |
| Cache de segmentos — evictions na carga normal | **0** |
| Falhas de fetch/rejeição cifrada observadas | **4** (inclui as negativas, posteriormente recuperadas) |
| Pico de cache em memória | **255.366 bytes**, duas empresas |
| Uso final por empresa | **127.683 bytes**, cada |
| Limite por empresa / TTL | **256.000 bytes / 30 s** |
| Pico de memória RSS do processo Python | **120.940 KiB**, ~118 MiB |

A baixa contagem de GETs de segmentos demonstra valor do cache em **consulta repetida no mesmo runner e mesmo processo**, não comprova redução real de GET/PATCH no device-gateway atual das TVs. Os resultados HTTP completos, por sua vez, produziram **34,7 MB de egress** mesmo com GET de arquivo relativamente baixo. O custo de transferência de respostas pode superar o custo das consultas ao arquivo, dependendo do tráfego.

## Bytes de banco, índices, objetos e hipótese de custo

| Componente | Bytes |
|---|---:|
| Banco PostgreSQL QA ao final das consultas | **13.432.499** |
| Índices do histórico original | **335.872** (já incluídos no banco) |
| Índices CQRS diário | **16.384** (já incluídos no banco) |
| Dez segmentos AES-256-GCM | **346.020** |
| Manifesto | **3.781** |
| Baseline JSON do QA — apenas para comparação | **4.196.959** |
| Chave de teste — apenas QA | **32** |
| **Total somado (banco + objetos + manifesto + baseline de QA + chave)** | **17.979.291** |

**Cuidado:** a baseline JSON de 4,197 MB não é um requisito obrigatório de produção. Sem ela, a soma dos componentes mencionados ficaria aproximadamente 13,782 MB mais eventual gestão de chave. O tamanho do banco inclui alterações internas, catálogos e overhead de TEMP SQL de benchmark. Não é correta uma comparação simples de `pg_database_size` antes/depois entre runners ou fases diferentes. **Nenhuma economia líquida de armazenamento foi comprovada** com os 664 originais preservados; cache + arquivo + CQRS adicionam despesas, ainda que evitem uma segunda tabela permanente completa.

**Exemplo hipotético de preços, NÃO tarifa verificada de provedor:** parâmetros fixos do script (somente demonstração matemática) US$ 0,025/GB-mês para armazenamento de objetos, US$ 0,0004 por 1.000 GET e US$ 0,09/GB egress. Nessa amostra: US$ **0,00000865/mês** de objetos, US$ **0,0000112** por 28 GETs e US$ **0,00311986** para 34,7 MB de respostas. **Não inclui Supabase, API Edge, tempo de CPU, WAL, banco, backups, armazenamento de mídias, impostos ou custos reais.** Não projetar economia financeira com base nesses coeficientes sintéticos.

## Decisão GO/NO-GO

**PASS:** completude de 800 respostas JSON comerciais sobre AES-256-GCM sob demanda sem segunda cópia permanente, cache separado por empresa, TTL, quota, RLS/JWT sintéticos, falha de objeto/alteração/chave, recuperação, limites de fila, métricas de memória e recursos. **GO apenas para otimizar em CI descartável.**

**NO-GO produção** pelas latências P95/P99 elevadas com 300 clientes, ausência de KMS e provedor de objetos durável, falta de testes prolongados com 300 falhas simultâneas e nenhuma economia total de banco comprovada. A TV Android, Supabase real, Vercel, CDN, Storage real e autenticação implantada não foram testados.

**Próxima medida prudente:** prototipar pool de conexões ou projetor/consulta híbrida com resumo diário para summary/campaign/media/device e arquivo detalhado somente quando o usuário pedir os eventos recentes ou exportação; manter JSON atual, hashes e RLS. Medir P95/P99 com 100/300 consultas, cache quente/frio e fila sob falha por períodos, verificando custo completo e segurança antes de pensar em publicar.

**Produção preservada:** zero Supabase, APK, site, painel ou TVs alterados. Nenhuma prova original excluída; somente o banco e arquivos descartáveis do CI foram criados.
