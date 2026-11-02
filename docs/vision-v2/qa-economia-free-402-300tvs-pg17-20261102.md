# Vision V2 — orçamento Supabase Free, HTTP 402 e provas PostgreSQL 17

Data: 02/11/2026. Base: 24f112034fe4a0e0df33ed02eb1404926b5fe736.
Código técnico auditado: 25b1cb9b251642a2b47e3655bc4e832952c08ae3.
Branch exclusiva: experiment/vision-v2-sequence-watermark-qa-20261031.

**Veredito: QA PASS; 300 TVs com 15s e comprovante individual por evento no Free = NO-GO econômico. Segurança TOCTOU também segue FAIL/NO-GO.**

Nenhum acesso, alteração ou deploy em Supabase oficial, APK, TVs, painel, site, dados reais ou main. QA_STREAM_GUARD_GROUP=1. Drain não ativado.

## Incidente anterior — separar evidência de hipótese

No sistema antigo foram investigados volume elevado de GET/PATCH, autenticação e heartbeat com gravacões repetidas, históricos crescentes e HTTP 402. Essas observações motivaram deduplicação de credenciais e comprovantes, bundling, cache e TTL. O HTTP 402 é compatível com restrições por Fair Use, mas esta execução NÃO inspecionou billing ou quotas da conta oficial, logo NÃO identifica qual item gerou a restrição histórica.

Fontes oficiais públicas consultadas: https://supabase.com/docs/guides/platform/billing-on-supabase ; https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations ; https://supabase.com/docs/guides/platform/manage-your-usage/egress ; https://supabase.com/docs/guides/platform/billing-faq

Free de referência: 500.000 Edge invocations/mês, 5 GB de egress não cacheado, 500 MB banco por projeto, 1 GB Storage. Edge invocations e egress são cotas por organização, divididas entre projetos. Erros HTTP de Edge também contam na cota, exceto preflight OPTIONS. POST/GET PostgREST não são por definição Edge invocations. O QA impõe margem interna conservadora de 70%: 350.000 invocations, 3,5 GB egress não cacheado, 350 MB banco e 700 MB Storage, **não são limites oficiais**.

## Testes executados e evidências

- [Node 20 e Node 22, run 41526087856](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41526087856): **2/2 jobs PASS, 22/22 testes por versão.** Modelo de 10/100/300 TVs, horário 8/12/18/24h, Edge, mídia, relatórios, budget fail-closed, 402/429/503/401/403, ACK inválido, queue de 7 dias, jitter anti-storm.
- [PG17 descartável, run 41525792976](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41525792976): **1/1 PASS.** 300.000 comprovantes físicos em tabela indexada sintética, ondas de 100 e 300 clientes com 50 eventos, reenvio duplicado sem novas linhas e métricas WAL/RSS/tamanho.
- [Dois FAILs de harness SQL parametrizado, preservados: 41525492353](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41525492353) e [41525632144](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41525632144). Causa: escape incompleto do operador módulo % do PostgreSQL em psycopg; corrigidos só no teste, sem tocar no produto.

### Resultado físico de banco

300.000 comprovantes sintéticos: relação total **80.740.352 bytes**, heap **42.377.216 bytes**, índices **38.322.176 bytes**, crescimento físico **80.707.584 bytes** ou **269,025 bytes/prova** na estrutura QA. Banco completo com amostra: **88.446.643 bytes**.

Se repetido linearmente para 51.840.000 eventos/mês: **13.946.270.515 bytes (~13,95 GB) na relação+índices**. Esta extrapolação NÃO é previsão exata da estrutura comercial. Mesmo uma estrutura muito menor por evento enfrentaria a cota de 500 MB, além das demais tabelas.

Depois dos lotes de 100/300 clientes: 315.000 comprovantes distintos, nenhum duplicado após reenvio, WAL incremental **145.788.528 bytes**, banco **92.763.827 bytes**. Na onda de 300 novos lotes, execução SQL P95/P99 **23,333/30,312 ms**; reenvio P95/P99 **12,580/16,097 ms**, pool máximo 12, PostgreSQL 17 local, sem rede externa. RSS Python **44.440 KiB**; não inclui serviço PostgreSQL/kernel.

### O mínimo matemático de Edge invocations, se 50 provas por lote

| TVs | Horas/dia | Provas em 30 dias | Lotes de 50 mínimos |
|---:|---:|---:|---:|
| 10 | 24 | 1.728.000 | 34.560 |
| 100 | 24 | 17.280.000 | 345.600 |
| 300 | 24 | 51.840.000 | 1.036.800 |
| 300 | 18 | 38.880.000 | 777.600 |
| 300 | 12 | 25.920.000 | 518.400 |
| 300 | 8 | 17.280.000 | 345.600 |

No código de referência V2, o limite de lote é 50. Só o upload separado dos lotes de 300 TVs por 12h, 18h ou 24h já supera 500k Edge. Se o player chamar uma Edge Function a cada 2min, 300 TVs 24h representam **6.480.000 invocations/mês**, mesmo reunindo comandos/heartbeat/provas num ciclo. Bundling reduz invocations perante três funções separadas, mas não elimina automaticamente os SELECT/UPDATE/INSERT internos.

Para 300 TVs, um relatório gzip fictício de 437.137 bytes baixado uma vez por TV/dia equivaleria a **3,934 GB** em 30 dias só de corpos HTTP, acima da margem interna de 3,5 GB antes de mídia. É cenário fictício de relatórios, não evidência de TVs reais baixando esses arquivos. 170 MB de mídia efetivamente baixada por cada uma de 300 TVs equivalem a **51 GB** de transferência; 170 MB de espaço lógico não implica 170 MB de download. Diferenciar cache de Storage de egress não cacheado.

### Riscos visíveis no código legado do repositório

O módulo device-bundle-stable reutiliza o monitoramento cujo heartbeat ainda efetua UPDATE de devices.last_seen_at por chamada, SELECT de último heartbeat, INSERT periódico a cada 5 minutos ou alteração de diagnóstico, e varreduras offline controladas por Map local por isolate. A autenticação implementa janela de 60 segundos contra atualização de last_used_at em toda requisição: uma melhoria relevante. **Um único HTTP bundle não significa uma única escrita no banco.** Não houve medição desses caminhos oficiais, somente inspeção do código versionado.

### Circuit breaker HTTP 402: protótipo QA, não publicado

A fila sintética mantém eventos/watermark após 402 e escalona retry em 6h, 12h, 24h com jitter por TV, evitando tentativa repetida no mesmo segundo. HTTP 401/403 bloqueia reenvio com credencial inválida; 429/503 fazem backoff; HTTP 200 incompleto ou ACK fora do lote não apaga dados. Uma simulação mantém 40.320 provas por TV nos sete dias offline, mas é RAM Node: NÃO comprova SQLite durável, crash/SIGKILL real ou recuperação do APK. Não foi integrado ao player.

### Condições para reduzir custo SEM perder os relatórios

1. Manter resumos por dia/TV/campanha no PostgreSQL; comprovantes originais imutáveis e verificáveis em arquivo criptografado AES-GCM com SHA-256/manifesto e restauração provada, armazenados fora da tabela de eventos crescente, em infraestrutura que tenha quota e preço mensurados. NÃO descartar eventos nem apagar histórico existente.
2. Reformular experimentalmente a entrega em segmentos compactados/ACK transacional sem limite de 50 eventos por chamada, ou mover uploads de prova para armazenamento adequado. Medir quantas invocations permanecem com 300 TVs e preservar comandos/estado online próximos do tempo real.
3. Proteger cotas da ORGANIZAÇÃO, não somente da TV: Edge <=350k, egress não cacheado <=3,5GB, banco <=350 MB e Storage <=700MB como alvos de margem interna, levando em conta outros projetos; alertar antes de ultrapassar.
4. Preservar cache/offline, token, integridade e idempotência. Não permitir retry storms sob 402/429/503, nem ACK sem COMMIT.
5. Corrigir e provar o TOCTOU de gate/rota antes de qualquer GO. Revalidar em PG17 descartável, 10/100/300 clientes, RLS, AES, WAL, RSS, P95/P99, 402 e full report.
6. Não prometer que Supabase Free sustentará 300 TVs: o protocolo atual NÃO satisfaz os orçamentos. Validar arquitetura de arquivos e custos reais ANTES de migrar ou instalar.

**Decisão: continuar somente na branch QA. A economia deve ser comprovada por invocations, egress, DB, storage e disponibilidade; não apenas por percentual de GET reduzidos. Produção NO-GO.**
