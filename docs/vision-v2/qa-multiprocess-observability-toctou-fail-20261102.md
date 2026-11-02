# Vision V2 — auditoria multiprocessos da recuperação após SIGKILL e TOCTOU

Data: 02/11/2026. Branch experimental: experiment/vision-v2-sequence-watermark-qa-20261031. Base preservada: c9ee4b6d1c36519cd0274c9ffbeeaf09eb6cd59f. Código técnico testado: 1a12e3cd62ed7f272c12b4c7273730c29b4fb214. Streaming de um bloco (QA_STREAM_GUARD_GROUP=1), drain desativado. Não houve acesso aos serviços oficiais, TV, APKs, site, painel, histórico real ou main. Produção **NO-GO**.

## Resultado correto: QA PASS, segurança FAIL

[A — Nova investigação PG17: 6/6 jobs de QA PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41514055031). A matriz de 300 clientes, pools 8/12/20 e chunks 64/256KiB executou testes com duas instâncias proxy+origem em subprocessos reais independentes. Todos reproduziram um **contraexemplo concreto de TOCTOU na admissão**. A conclusão embutida nos relatórios é **security_verdict=FAIL_NO_GO**. O exit code do QA foi 0 porque a *reprodução esperada da vulnerabilidade* passou. É proibido interpretar esses seis PASS como aprovação de segurança.

[Regressões comerciais originais B: 14/14 PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41513466725): seis corridas de 300 clientes, seis transportes multiprocesso reais, e dois testes AES-GCM/outbox/memfd/revogação. Nenhum módulo comercial original foi alterado ou implantado. Preserva-se a restrição de não testar em produção.

## TOCTOU reproduzido deterministicamente

1. Um proxy inicia o HTTP GET e confirma no PostgreSQL que o gate está aberto, liberando sua transação e lock advisory.
2. A bancada mantém a solicitação em pausa depois da checagem e antes da escolha da porta da origem.
3. Outro processo fecha o gate em uma transação PostgreSQL e COMMITA; altera a rota para outra origem HTTP real.
4. A requisição retida é liberada e recebe **HTTP 200 completo**, apesar de o gate já estar fechado.

Este comportamento é um **FAIL de segurança da bancada causal experimental**, e prova que checar gate antes de escolher a origem, sem proteção contínua de admissão, é insuficiente. Não comprova a mesma falha no código oficial, que não foi acessado nem alterado. Não promover a abordagem. O teste foi mantido como prova negativa, não se aplicou correção não comprovada ao produto.

## SIGKILL, rebind, buffers e preservação da evidência

O controlador usa duas instâncias independentes de proxy/origem e um PostgreSQL 17 descartável. A revogação e o cutover comercial são concorrentes sob barreiras de processo. Um HTTP 200 antigo, iniciado antes do COMMIT de revogação, é convertido em HTTP 503 fail-closed após interrupção, com zero novas escritas de aplicação depois do COMMIT no caso testado.

No teste SIGKILL, a origem registra 7.000 bytes da resposta HTTP antes do término forçado. A instância proxy sobrevivente descarta os mesmos 7.000 bytes, não apresenta HTTP 200 incompleto e não faz retry. Uma rota para origem morta responde 503, diferentemente da negação de membership 401 após rebind saudável. O reinício consulta o epoch atual do PostgreSQL. Bytes em buffers TCP que já haviam sido enviados antes do COMMIT não podem ser revogados fisicamente pelo experimento. Dois subprocessos no MESMO runner não representam dois hosts em redes diferentes.

## SQL completo explícito, RSS por PID e restrições

Foram instrumentadas todas as invocações explícitas ao método psycopg.execute() no controlador e nos três ciclos de vida de subprocesso: primeira origem/proxy até SIGKILL, proxy sobrevivente e origem/proxy reiniciados. A última amostra do processo morto é feita ANTES do SIGKILL; as métricas do processo anterior não são confundidas com as do substituto.

- Chunk 64KiB: 11.260 chamadas SQL explícitas observadas = 11.192 de workers + 68 do controlador; 2.798 guardas SQL específicos.
- Chunk 256KiB: 5.120 chamadas SQL explícitas observadas = 5.052 de workers + 68 do controlador; 1.263 guardas específicos.

Estes valores incluem os SQL do script de QA; **não** incluem BEGIN/COMMIT implícitos do driver, overhead do PostgreSQL ou requisições à plataforma oficial. Não se devem interpretar como totais faturados.

O Linux /proc/self/status confirmou que o ru_maxrss do processo reiniciado podia refletir um valor de 172–201MiB associado ao processo criador; o VmHWM **por PID** do worker reiniciado era cerca de 55–56MiB. Foram preservados VmHWM e VmRSS por PID para as três vidas, além da memória do controlador. **Não somar picos de vidas diferentes para estimar RSS simultâneo**, e não atribuir page cache, postgres ou kernel ao RSS Python.

## Matriz A — resultados reais

| Pool | Chunk | P95 300 GETs ms | P99 ms | GETs | HTTP 200 | HTTP 401 | HTTP 503 | SQL execute explícitos | WAL pós-fixture bytes |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 | 64KiB | 776.171 | 1389.142 | 326 | 307 | 6 | 13 | 11260 | 242848 |
| 8 | 256KiB | 819.693 | 1163.912 | 326 | 307 | 6 | 13 | 5120 | 242848 |
| 12 | 64KiB | 783.039 | 1329.980 | 326 | 307 | 6 | 13 | 11260 | 73032 |
| 12 | 256KiB | 660.993 | 1326.721 | 326 | 307 | 6 | 13 | 5120 | 242848 |
| 20 | 64KiB | 1277.464 | 1545.779 | 326 | 307 | 6 | 13 | 11260 | 242848 |
| 20 | 256KiB | 542.488 | 1301.673 | 326 | 307 | 6 | 13 | 5120 | 242904 |

Cada cenário teve 300 HTTP 200 íntegros na onda principal; o 307º HTTP 200 foi o contraexemplo de segurança com o gate já fechado. Corpos HTTP completos recebidos: 134.201.059 bytes por job. Bytes parciais recebidos do upstream e descartados: 100.536 (64KiB) ou 297.144 (256KiB). Os HTTP 401/503 devolvidos tinham corpo vazio. Logs completos e snapshots por PID nos artefatos do workflow. P95/P99 medidos apenas na onda de 300 clientes, não incluindo as 26 negativas.

Os testes de regressão B mantiveram 0 503 por admissão TOCTOU na suíte comercial ORIGINAL, mas ainda ocorreram erros 503 fail-closed pós-header (por pool 8: 1/0; pool 12: 0/0; pool 20: 20/5 nas configurações 64/256KiB desta execução). Segurança/integridade comercial PASS não elimina falhas de disponibilidade. AES-GCM e outbox permaneceram validados.

Projeções apenas matemáticas da fixture anterior: 1 GET gzip diário × 30 dias × 437.137 bytes = 1,311411 GB por 100 clientes, ou 3,934233 GB por 300 clientes. Não inclui imagens, vídeo, heartbeats, retransmissões, API, TLS, retenção, WAL, custos em reais ou capacidade real do Supabase Free.

**Decisão: FAIL de segurança no experimento, não publicar nem promover. Produção NO-GO.**
