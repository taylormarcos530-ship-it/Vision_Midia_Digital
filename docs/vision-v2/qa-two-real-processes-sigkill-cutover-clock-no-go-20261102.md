# Vision V2 — revisão adversarial com dois processos reais, SIGKILL e PostgreSQL 17

**Data:** 02/11/2026. **Branch experimental exclusiva:** experiment/vision-v2-sequence-watermark-qa-20261031. **Base preservada:** 6dfecd9cfb0a3a10c6540a34cbca30f18551494f. **HEAD técnico validado:** 787860cfb83d80bf5f7f611b6d796cb222cdc0fb. **Decisão:** PASS no ambiente de testes local descartável, **produção NO-GO**.

O código comercial original não foi modificado. Manteve-se QA_STREAM_GUARD_GROUP=1 (um bloco por guarda/transação) e drain NÃO foi habilitado. Nenhum acesso ou modificação ao Supabase oficial, Vercel, main, site, painel, APK, TV ou histórico real. Nada foi publicado.

## Evidências de GitHub Actions — execuções reais e FAIL preservado

- [Nova bancada PG17, 300 clientes × 6 cenários — run 41491581574](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41491581574): **6/6 PASS**, código HEAD técnico acima, 6 artefatos com todos os GETs registrados e resumo JSON, dois processos Python independentes spawnados por subprocess.Popen, cada um hospedando um proxy e uma origem HTTP em sockets reais, com pools SQL distintos para proxy e origem.
- [Regressão comercial e transporte original — run 41491083286](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41491083286): **14/14 PASS**, 6 testes comerciais 300 clientes, 6 testes TCP FIN/RST/half-open multiprocessos e 2 testes de AES-GCM, outbox, memfd, RLS e revogação. Este código comercial não recebeu alteração nesta etapa.
- [Primeira execução multiprocessos — run 41490988619](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41490988619): **6/6 FAIL preservados**, devido à hipótese errada da própria sequência de recuperação: após SIGKILL, um proxy continuava roteado para origem morta e respondia corretamente 503 fail-closed, não 401. Corrigido SOMENTE no teste: primeiro verificar 503 na rota morta, depois rebind para origem saudável, então confirmar 401 do usuário revogado. Não confundir 503 de rota com falha na autorização. Os logs desse FAIL não foram removidos.
- [Sequência e relógio offline](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41491581583) foi acionada à parte e não é incluída nos 20 jobs principais.

**Total final dos dois workflows aprovados:** 20/20 PASS (6 novos + 14 regressões). Os 6 FAIL históricos permanecem documentados.

## Topologia e limites de segurança

Cada um dos DOIS subprocessos Python tem seu próprio PID, proxy HTTP loopback, origem HTTP loopback, conexões PostgreSQL independentes e comandos via pipes. A instância de teste usa dois processos distintos no MESMO runner/host, não duas máquinas reais. Ambos leem gate e membership de uma instância PostgreSQL 17 no contêiner descartável, usando locks advisory por transação e role QA leitora com FORCE RLS. Os pools somam 8, 12 ou 20 conexões de worker nos dois subprocessos, sem contar as conexões temporárias do controlador: para 8, cada processo usa 4 conexões; para 12, 6; para 20, 10. Cada processo divide seu orçamento entre proxy e origem, sem conexões SQL compartilhadas entre processos. O teste valida os backend PIDs vivos e nega RLS desabilitado, escrita indevida, leitura de tenant alheio ou role com bypass.

A corrida controlada mantém um stream antigo depois da primeira escrita de bloco; simultaneamente duas threads independentes disparam **transação de revogação membership** e **transação que fecha gate e muda roteamento**. A barreira e as confirmações de COMMIT ocorrem antes de liberar o stream antigo. Quando o gate reabre, usuário revogado recebe 401 da origem acessível. O antigo HTTP 200 incompleto vira 503 sem corpo no proxy, sem retry e sem nova escrita da aplicação depois do COMMIT. Não é garantia de entrega/retirada física de bytes pré-bufferizados do kernel.

Em seguida um SIGKILL atinge somente um subprocesso criado pelo teste, quando a origem registra 7.000 bytes de resposta HTTP parcial antes da morte. O proxy sobrevivente registra os mesmos 7.000 bytes parciais como descartados e devolve 503, jamais um HTTP 200 truncado como sucesso. Gate fechado fica visível mesmo após reiniciar o processo. Após reabrir o gate com membro ainda revogado, a rota morta retorna 503; após rebind para a nova origem acessível, a negação real é 401; somente após regrant há novo 200 SHA íntegro. O processo reiniciado lê o epoch atual do PostgreSQL (observado epoch 6), sem reutilizar snapshot local de gate antigo.

Relógio: child 0 recebe wall clock Python SIMULADO em -24h; child 1, +24h. Nenhum relógio do host, sistema operacional ou do PostgreSQL foi alterado. Cada subprocesso executa sleep real ~55 ms para um deadline monotônico de 25 ms; a janela é rejeitada após ultrapassar ~30 ms em ambos os clocks. Não prova deadline físico rígido de 420ms ou estabilidade quando o próprio SO altera o relógio.

## Matriz final — seis jobs reais, 300 solicitações normais

| Pool total de worker | Bloco | P95 normal ms | P99 normal ms | GETs totais | SQL guards observáveis* | WAL pós-fixture bytes | RSS do controlador KiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 | 64KiB | 549.429 | 715.057 | 325 | 1414 | 242608 | 171924 |
| 8 | 256KiB | 845.398 | 1068.030 | 325 | 639 | 242608 | 203704 |
| 12 | 64KiB | 767.673 | 1362.994 | 325 | 1414 | 242608 | 181276 |
| 12 | 256KiB | 827.926 | 1469.836 | 325 | 639 | 242608 | 203728 |
| 20 | 64KiB | 705.132 | 1289.839 | 325 | 1414 | 97368 | 190212 |
| 20 | 256KiB | 999.034 | 1341.026 | 325 | 639 | 242608 | 178560 |

**Cuidado de medição:** os contadores SQL instrumentados são apenas os guardas disponíveis nos processos **sobreviventes/reiniciados**, e NÃO incluem o total antes de SIGKILL no processo destruído, além de não representarem todos os statements SQL. Não usá-los para comparar custo total de SQL por pool ou estimar consumo de Supabase. WAL refere-se ao delta de LSN da fixture local PG17; valores diferem por agendamento/runner e não equivalem a WAL mensal. O banco fixture do teste ocupava **7.788.211 bytes**, índice membership **16.384 bytes**. RSS do controlador: **171.924–203.728 KiB**; RSS dos processos sobreviventes reportado individualmente, mas o pico do subprocesso destruído não foi retido. PostgreSQL, kernel e cache de página não foram somados. Os percentis P95/P99 são apenas dos 300 GETs normais, não dos 25 probes adicionais, e os jobs executaram em runners independentes com agendamento diferente.

## Egress e conservação de tentativas

Cada job: **325 GETs reais tentados uma vez cada, nenhuma repetição automática**, sendo **306 respostas HTTP 200 íntegras** (300 onda inicial + 6 verificações posteriores), **6 HTTP 401** e **13 HTTP 503** (RST, FIN, half-open, gates fechados, origem SIGKILL e rota obsoleta). Nenhum HTTP 200 incompleto foi aceito, nenhum GET foi automaticamente repetido. Todos os relatórios têm 10.000 eventos originais SINTÉTICOS e o SHA-256 é verificado no cliente.

O corpo gzip de cada relatório íntegro tinha **437.137 bytes**. Logo 306 respostas completas corresponderam a **133.763.922 bytes recebidos pelos clientes** por job; os 19 corpos de erro eram de tamanho zero. Separadamente, bytes previamente recebidos pela camada proxy, porém DESCARTADOS por falha/truncamento, somaram **100.536 bytes (64KiB)** ou **297.144 bytes (256KiB)** em cada job. Isso inclui os 7.000 bytes antes do SIGKILL comprovados no ledger, mas não captura métricas de bytes enviados e perdidos no processo morto nem os buffers TCP/kernel de sistema. Headers, TCP, TLS e demais overheads não estão incluídos. Comparar bytes completos com a métrica de upstream descartado sem somar duas vezes.

## Regressoes originais: AES-GCM, outbox, RLS, TCP

No run 41491083286 todos os 14 jobs passaram, inclusive segurança SHA-256, conteúdo comercial original, AES-GCM, outbox e memfd. As seis corridas comerciais originais permanecem com **0 erros de admissão por TOCTOU**. Os HTTP 503 fail-closed pós-header ainda aparecem e variam por interleaving, por pool 8/12/20 e chunk 64/256KiB: respectivamente **1/7, 1/10, 20/16**. Os seis jobs de transporte multiprocesso original fizeram 300 HTTP 200 íntegros e 309 GETs por configuração, incluindo FIN/RST/half-open e revogação; dois jobs adversariais de faults provaram zero novas escritas de aplicação após o COMMIT de alteração comercial ou revogação, com AES-GCM/outbox preservados. Integridade PASS **não significa redução comercial de erros**.

## Projeções matemáticas sem custos inventados

Um relatório de 437.137 bytes gzip, um GET por cliente por dia, 30 dias: para 100 clientes **1,311411 GB/mês** e para 300 clientes **3,934233 GB/mês** de corpos gzip (GB decimais). Isto NÃO inclui imagens/vídeos, heartbeats, metadados, armazenamento, WAL, índices, cancelamentos, retries, overhead HTTP/TLS ou preços reais em R$. Não foi medida nem confirmada a capacidade do Supabase Free para 300 TVs.

## PASS/FAIL e decisão

| Item | Resultado |
|---|---|
| 6 jobs multiprocessos finais em PG17 descartável | **PASS 6/6** |
| Regressões comerciais e TCP originais AES-GCM, outbox, RLS | **PASS 14/14** |
| 300 HTTP 200 íntegros, SHA-256/10.000 eventos por cenário | **PASS 6/6** |
| Dois processos independentes, cada um com proxy/origem reais | **PASS mesmo host** |
| Cutover concorrente com revogação, sem 200 obsoleto completo | **PASS na bancada** |
| SIGKILL depois de 7KB, fail-closed e recuperação sem gate obsoleto | **PASS na bancada** |
| Clocks Python simulados ±24h e deadline monotônico atrasado | **PASS, escopo simulado** |
| Nenhuma repetição automática de 401 ou 200 truncado | **PASS 6/6** |
| Primeiro harness, expectativas de 401 com rota morta | **FAIL 6/6 preservado e corrigido somente em QA** |
| TCP físico/coordenação entre hosts reais, WAL/SQL total, segurança do ambiente oficial | **NÃO COMPROVADO** |
| Redução dos HTTP 503 comerciais originais | **NÃO: permanecem fail-closed** |
| Capacidade 300 TVs reais, custos e faturamento Supabase Free | **NÃO MEDIDOS** |

**Produção NO-GO. Sem deploy, sem alterações na lógica original. Preserve as versões e todos os relatórios.**
