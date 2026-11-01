# Vision V2 — Deadline monotônico, queda de TCP após HTTP 200 e recuperação AES-GCM

**Data:** 01/11/2026. **Branch experimental exclusiva:** experiment/vision-v2-sequence-watermark-qa-20261031. **HEAD inicial confirmado:** f696ba4666898c4315570798262903f3d275d80a. **Último SHA de código testado:** 5c870f53a53e41be64967c5a8f5df16bdb542133.

**Resultado: 12/12 PASS nos novos cenários HTTP; 7/7 PASS na regressão de AES-GCM, outbox e revogação; 12/12 PASS na regressão comercial original; sequência/offline PASS. PRODUÇÃO NO-GO.**

## Evidência de GitHub Actions

- [12/12 — deadline, TCP truncado, half-open e PostgreSQL17](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41354378113), commit de código 5c870f5.
- [7/7 — AES-GCM/PG indisponível, outbox multiprocesso, manifesto e escrita após revogação](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41354282223).
- [12/12 — regressão comercial completa de pools, relatórios originais e rollback](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41354378105).
- [Sequência/offline — PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41354378109).
- [Repetição redundante do caso 100 clientes/pool12/256KiB](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41354636757), disparada enquanto o job original aguardava checkout. Não é usada para atribuir PASS ao job original, que depois passou.

## Resultado de segurança e limite rígido

O corte de rota agora toma uma decisão atômica e imediata usando ponteiro protegido por mutex e relógio monotônico: nenhum pedido novo é atribuído à instância antiga depois da troca. Teste com relógio virtual atrasado 650ms e com atraso REAL de execução de 540ms: decisão continua usando a instância nova. Contudo, houve aproximadamente 120ms de execução além do prazo nominal de 420ms. **Não foi demonstrado prazo físico rígido de 420ms para esgotamento de conexões antigas; essa condição permanece FAIL/NO-GO.** Nenhum processo consegue garantir duração física quando não é escalonado pelo sistema operacional.

Os clientes foram expostos a um cabeçalho HTTP 200 com Content-Length total seguido de apenas parte dos bytes: o socket realmente interrompido levou a IncompleteRead; a conexão half-open gerou TimeoutError durante leitura com prazo de 240ms. Nenhuma dessas respostas incompletas é aceita como HTTP 200 íntegro ou repetida automaticamente. Um pedido explícito novo para o servidor íntegro retorna 200 com JSON de 10.000 eventos sintéticos e SHA-256 válido. Revogação na role PostgreSQL17 com FORCE RLS retornou HTTP 401 antes de corpo completo, sem retry; pedido seguinte após restabelecimento foi íntegro. O marcador de token usado pela nova suíte é sintético, não JWT/JWKS real.

Prova independente em PostgreSQL17 com transação compartilhada por bloco e revogador com lock exclusivo: **0 novas escritas de aplicação após COMMIT de revogação** com blocos 64/256KiB; COMMIT de revogação 32,77/32,54ms, comercial 34,47/33,56ms. O primeiro bloco já havia sido escrito antes do COMMIT; bytes de buffer TCP ou do proxy podem ser entregues depois. Ausência de entrega pós-COMMIT pelo kernel **não foi comprovada**.

## P95 / P99 reais no CI da nova bancada, milissegundos

| Pool PG por processo | Bloco | 100 clientes P95/P99 | 300 clientes P95/P99 |
|---|---:|---:|---:|
| 8 | 64KiB | 1042,103 / 1079,658 | 1141,153 / 1209,516 |
| 8 | 256KiB | 236,231 / 249,325 | 316,735 / 1178,314 |
| 12 | 64KiB | 1072,491 / 1234,876 | 1390,504 / 1648,551 |
| 12 | 256KiB | 1288,214 / 1312,455 | 327,058 / 1180,566 |
| 20 | 64KiB | 2737,190 / 2791,308 | 1302,310 / 1502,533 |
| 20 | 256KiB | 1072,932 / 1265,259 | 1259,670 / 1390,539 |

Os 12 casos passaram com 100/100 ou 300/300 GETs íntegros após injeções independentes de falhas de transporte. Casos executados em runners diferentes; diferenças não são prova causal de vantagem de pool. 100 clientes produziram 105 GETs locais (incluindo negativos/recuperação), 300 produziram 305. Não houve GET de mídia real.

## SQL, RAM, armazenamento, WAL, egress e custos

A nova fixture de 10.000 eventos tem gzip de **73.119 bytes por resposta**, egress de **7.311.900 bytes para 100** e **21.935.700 bytes para 300**. Este payload é intencionalmente diferente do relatório comercial completo original, de ~351.751 bytes gzip, então NÃO é uma redução comprovada de egress dos relatórios reais.

Banco descartável da nova fixture: **7.763.635 bytes**, índice de associação RLS **16.384 bytes**, WAL após inicializar fixture aproximadamente **215.776 bytes**. RSS observada do processo principal nos 12 runners: aproximadamente **84 a 135 MiB**, não é a soma de filhos/PG/kernel. Invocações de autorização SQL estimadas na nova suíte: 100 clientes **400/300** por blocos 64/256KiB; 300 clientes **1.200/900**. Não são totais precisos de instruções de SQL; cada guarda executa múltiplos comandos. O histórico comercial completo de regressão continua separado: ~22MB de DB e ~9,81MB de índices originais, com WAL dos eventos inicialmente carregados fora da janela de medição.

Projeção para 30 dias, supondo exatamente um relatório completo por cliente por dia, sem retries/mídia: nova fixture reduzida 73.119 bytes = **219,357MB para 100 clientes** / **658,071MB para 300**; modelo comercial original 351.751 bytes = **~1,055GB / ~3,166GB**. Com polling opcional de duas réplicas a cada 30 segundos, estimativa SQL antiga para relatório original 64KiB: **322.800 / 622.800 comandos por mês**; 256KiB: **238.800 / 370.800**. Esses valores são apenas modelagem, sem auditoria completa SQL ou preço real de Supabase, e não incluem vídeos, imagens, heartbeat, storage/GETs ou retenção.

## AES-GCM, outbox e outras regressões

3/3 testes de crash AES-GCM após rename 1, rename 2 e manifesto antes de COMMIT SQL; conexão PostgreSQL TCP recusada em localhost durante recovery manteve PREPARED e bloqueou leitura de geração incompleta; outro processo carregou chave SINTÉTICA de arquivo privado modo 0600 e concluiu 4/4 verificações SHA, repetição idempotente e limpeza de geração anterior sem invalidar descritor selado. A fixture pequena da rotação tinha ~7,74MB DB, 16KB índice e ~973KB de arquivos. Isso não substitui KMS/HSM.

Outbox multiprocesso com ordem, checkpoint e recuperação após crash PASS. Manifesto AES-GCM remoto SIMULADO com upload parcial, hash e recuperação PASS; GETs/PUTs simulados não representam Storage de produção. Regressão comercial original 12/12 PASS, incluindo AES-GCM, cache de relatórios originais, 100/300 clientes, cutover/rollback, revogadores concorrentes, RLS sintética e pools reutilizáveis.

## Bloqueios PRODUCTION NO-GO

1. Prazo físico rígido de 420ms NÃO comprovado; a nova estratégia impede novos admissions na rota antiga, mas não encerra magicamente sockets e buffers já ativos.
2. Zero novas chamadas de escrita após COMMIT foi comprovado nos testes cooperantes, não zero bytes recebidos posteriormente pelo usuário.
3. Half-open e 200 truncado ficam FAIL-CLOSED para o cliente; transferência parcialmente recebida não é retomada automaticamente. Perda prolongada/cross-region e dois hosts físicos não foram testados.
4. Sem JWT/JWKS oficiais, matriz real de privilégios de revogação, Supabase oficial, provider KMS ou testes reais com vídeos/TVs.
5. Não há comprovação de suportar 300 TVs reais ou do plano Supabase Free; custos monetários não medidos.

**Apenas QA isolado: GO para testes adicionais, PRODUÇÃO NO-GO. Nenhuma publicação.**
