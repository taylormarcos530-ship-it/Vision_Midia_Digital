# Vision V2 — QA de falhas TCP entre processos, recuperação AES após falha PostgreSQL e bloqueio de escrita HTTP

**Data:** 2026-11-01. **Branch exclusiva:** experiment/vision-v2-sequence-watermark-qa-20261031.
**HEAD de partida confirmado:** 2399a4958b0f1ee1f069061b900911c82f621ffe.
**Commit de código testado para os 15 cenários de transporte/PG:** 5c5c2b8b1cffd9f6635aedb89c496f6e0a3b6f50.
**Commit dos testes de escrita protegida, código existente:** 5c289b23f59efc4c82bd919baaba616423c1dd6a.

**RESULTADO: 17/17 jobs desta etapa PASS. APENAS QA GO; PRODUÇÃO NO-GO.** Sem consultas, inclusive leitura, ao Supabase oficial. Sem alterações de main, APK, painel, Vercel/site, TVs, dados reais ou histórico real. Nenhum deploy.

## Evidência do CI real

- [15/15, PostgreSQL17 descartável, matriz de 12 testes de transporte e 3 cenários AES após indisponibilidade SQL — run 41348337329](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41348337329).
- [2/2, checagem independente de escrita HTTP por bloco 64/256KiB e revogação, run 41348549408](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41348549408).
- [Regressão anterior, 12/12 PG17, outbox e manifesto AES — run 41348304866](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41348304866).
- [Regressão anterior de sequência/offline — run 41348304910](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41348304910).

## Limites reais da simulação

Dois servidores HTTP independentes em processos de sistema operacional, um proxy e PostgreSQL17 local, todos no MESMO runner de GitHub. As 16 falhas de transporte em cada cenário são tentativas reais de socket connect() contra porta local fechada, portanto reais recusas TCP no estabelecimento da conexão. Isto NÃO é uma rede com dois hosts físicos, nem demonstra perda durante download iniciado, pacote descartado, half-open ou mudança de região. A falta de conexão é convertida pelo proxy em HTTP 503; apenas um GET idempotente com 503 é repetido até 5 vezes e 7,5 s. HTTP 401/403, corrupção SHA e HTTP 200 incompleto não são retried nem aceitos como relatório completo.

Cada um dos 12 casos teve todos os 100 ou 300 relatórios completos HTTP 200 com gzip, JSON original de 10.000 registros e SHA-256 válido após retry, zero 503 final. Houve 16 tentativas TCP recusadas por caso. Revogação JWT/RLS sintética: um único HTTP 401, corpo vazio e sem retry; volta a servir somente depois de associação restaurada.

## Métricas P99 dos clientes (incluem retries)

| PG pool + admissões HTTP | Bloco | 100 clientes P99 ms | 300 clientes P99 ms |
|---|---:|---:|---:|
| 8 | 64KiB | 2294.991 | 1724.201 |
| 8 | 256KiB | 1359.333 | 2120.340 |
| 12 | 64KiB | 1718.379 | 2774.209 |
| 12 | 256KiB | 1878.888 | 1928.247 |
| 20 | 64KiB | 2140.827 | 3003.354 |
| 20 | 256KiB | 1831.334 | 2592.586 |

Todos os cenários passaram separadamente em máquinas CI, portanto não inferir relação causal nem garantia de P99 a partir do ordenamento. P95 das ondas de 300 clientes variou de 1302.130 a 2247.659 ms. A maior espera de drain observada foi **433.451 ms** (20/64KiB com 300 clientes), ACIMA da meta configurada de 420ms. O teste ainda aceita menos de 500ms, portanto **TIMEOUT RÍGIDO de 420ms NÃO DEMONSTRADO / NO-GO para esse requisito**. Não houve garantia de hosts independentes.

## Segurança no instante de revogação: 2/2 PASS

Ensaios diretos reexecutados contra PostgreSQL17 real descartável nos blocos 64 e 256KiB. O servidor mantém o shared advisory transaction lock enquanto chama write+flush para um bloco. Alteração comercial e revogador concorrente usam lock exclusivo no MESMO tenant. A continuação da resposta após commit foi bloqueada: **zero novos bytes escritos pela aplicação após commit**, em ambos os ensaios. Tempos de COMMIT dos revogadores: 32.65ms (64KiB) e 33.26ms (256KiB). Commit comercial: 34.68ms / 33.86ms. O primeiro bloco da resposta já tinha 65536/262144 bytes escritos ANTES do commit. **NÃO é prova de zero bytes entregues pela rede depois do commit**, pois buffers TCP/proxy preexistentes podem ser drenados após a revogação. Protocolo depende de revogadores cooperantes; aplicação Supabase oficial sequer consultada.

Os mesmos dois ensaios verificaram criptografia de fonte e cache em disco, checksum e descritor memfd imutável, corrupção recusada, falha de conexão PostgreSQL negada com 503 e substituição de uma conexão em pool (12 iniciais, 13 criadas ao todo), crash após fsync antes de rename e replay durável. Consumo dos testes negativos: arquivo criptografado ~5.94MB por trabalhador, banco sintético ~21.94MB, RSS do processo de teste ~81MiB.

## Rotação AES-GCM: falha PostgreSQL durante recuperação

Três casos independentes: crash imediatamente após rename 1 (código 94), rename 2 (95) e manifesto de geração 1 publicado antes do COMMIT SQL (96). Cada caso gerou conexão TCP recusada de verdade para porta local fechada ao tentar continuar receipt PREPARED. A falha impediu avanço do recibo; quando a geração nova aparecia no manifesto, a leitura foi negada até o recibo COMMITTED. Um SEGUNDO processo carregou a chave-sintética de teste persistida em arquivo privado com modo 0600, restaurou conectividade ao PostgreSQL17, reprocessou o recibo idempotentemente e verificou 4/4 arquivos AES-GCM por hash. Eliminou os quatro arquivos da geração antiga sem invalidar memfd previamente selado.

Banco desta suíte pequena de recibos: 7,739,059 bytes, índice qa_v2_durable_rotation 16,384 bytes, arquivos encriptados remanescentes 973,477 bytes, RSS ~61,900KiB. Estes dados são de uma fixture menor, NÃO do banco com 20K históricos. O segredo sintético no arquivo temporário é explicitamente proibido como padrão de custódia para produção.

## SQL, WAL, índice, RAM, egress, GETs e modelagem

Nos casos HTTP de 300 clientes, os contadores de autorização/revisão por bloco variaram aproximadamente de **1,512 a 3,549**, dependendo do bloco e dos retries. Não são todos os comandos SQL; cada autorização usa múltiplos SET/lock/claims/revisão/membership. Pools persistentes por processo de 8, 12, 20 conexões: duas réplicas abrem 16/24/40 conexões em conjunto, fora conexões administrativas. Os workers registraram RSS pico na faixa aproximada de 65–67MiB; banco PG17, buffers de kernel, memfd e processo coordenador não estão incluídos nesse valor de cada trabalhador.

O banco com relatórios sintéticos mediu aproximadamente 21.94–22.00 MB, índice playback_logs **9,805,824 bytes**, WAL incremental após criar 20,664 eventos sintéticos de 2,272–487,880 bytes nas respectivas execuções. WAL de ingestão inicial está excluído, impossível extrapolar para produção. Report egress gzip: aproximadamente 35.17MB por 100 clientes e 105.52MB por 300 clientes (relatórios completos, excluindo cabeçalhos e respostas de erro). **GETs de mídia real: zero avaliados.** Regressão anterior de manifesto AES minúsculo simulou 1 GET de 168 bytes e 4 PUT de 680 bytes, NÃO mídia.

Modelo hipotético de 30 dias, um relatório completo por cliente/dia (SEM vídeos/imagens/heartbeats): 100 clientes ~1.055GB gzip egress, 300 clientes ~3.166GB. Aproximação SQL com dois workers e polling extra a cada 30 s APENAS se implementado: 64KiB ~322,800 comandos/mês com 100 clientes ou 622,800 com 300; 256KiB ~238,800 com 100 ou 370,800 com 300. Estimativa de engenharia, NÃO medição completa SQL nem preço de Supabase em R$. Requisições de retries também elevam SQL.

## Bloqueios para produção

1. O requisito de timeout ABSOLUTAMENTE rígido de 420ms não foi provado; já se viu 433ms. Drain é loopback, sem controle de host remoto/autorização distribuída ou half-open real. Não garante 0 backend 503 em outros níveis de carga.
2. Garantia no ponto da escrita é de ausência de **novas chamadas da aplicação após commit**, não zero bytes recebidos pelo cliente. Buffers de kernel/proxy não são reversíveis. Revogadores oficiais e privilégios não foram auditados.
3. Geração AES-GCM com recibo é uma prova descartável. Chave-sintética persistida em 0600 não substitui KMS/HSM, gestão de segredos, split-brain, falha de energia ou coerência de hosts independentes.
4. 300 clientes são submissões HTTP concorrentes e não 300 TVs reais, nem 300 conexões simultâneas PostgreSQL. Não houve vídeo, objetos Storage reais, Supabase Free, contas reais ou histórico real.
5. Faltam benchmarks sustentados com 100/300 TVs, 30/90 dias de retenção, mídia, liga/desliga, falhas prolongadas e tráfego real, antes de qualquer decisão financeira ou publicação.

**PRODUÇÃO NO-GO. Apenas novas rodadas de QA isolado estão autorizadas. Nenhuma publicação.**