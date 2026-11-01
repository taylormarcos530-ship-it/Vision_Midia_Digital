# Vision V2 — QA de epoch de admissão multiprocesso e HTTP interrompido, 01/11/2026

**Branch única:** \`experiment/vision-v2-sequence-watermark-qa-20261031\`.
**HEAD inicial exigido e confirmado:** \`9eff56238744481369a6ef95139fb3585ed9670c\`.
**Última alteração de código executada:** \`7b1abdbe7c34fa64a57d0cb05ac10f37f2c84882\`.
**Decisão: QA PASS para a bancada sintética; PRODUÇÃO NO-GO. Nenhum deploy.**

### Execuções verificadas no GitHub Actions

- [Nova matriz multiprocesso, TCP real e prazos — 12/12 PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41358314336), com 100/300 clientes × pool de 8/12/20 × blocos gzip 64/256 KiB e PostgreSQL17 descartável; SHA \`7b1abdbe\`.
- [Relatórios comerciais completos, pool persistente, AES-GCM, cutover/rollback e regressões — 12/12 PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41358314468), mesmo SHA.
- [Recibos AES-GCM com conexão PostgreSQL recusada, outbox e escrita transacional protegida — 7/7 PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41358152677), SHA anterior \`f63d82ad\`, sem modificação dessas suítes depois dele.
- [Sequência/offline — PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41358314499), SHA \`7b1abdbe\`.

Os 31 jobs contados são distintos; a suíte de sequência/offline é adicional. Tentativas intermediárias anteriores e a primeira execução com contador de bytes não isolado estão preservadas, sem serem contadas no resultado final. A instrumentação foi corrigida para medir o primeiro bloco da revogação separadamente dos streams de falha TCP anteriores e contabilizar nove GETs adicionais por rodada.

### O que efetivamente foi testado

**Protocolo de admissão:** epoch e ponteiro compartilhados via memória multiprocesso e mutex, em dois processos de teste que tentam utilizar tickets emitidos antes do cutover. Após troca de rota, cada processo permanece impedido de reutilizar o ticket antigo; um \`sleep\` real de 560ms faz os processos acordarem aproximadamente **140ms APÓS** o deadline de 420ms. Zero novas admissões na rota antiga após a troca. A decisão lógica passa; **nenhum SLA físico de encerramento de streams em 420ms está comprovado**. Este é um runner com processos separados, NÃO máquinas ou regiões independentes.

**Quatro falhas de rede reais e diferenciadas**, sempre sob um cabeçalho HTTP 200 com Content-Length integral: (1) só cabeçalhos/sem corpo → \`IncompleteRead\`; (2) FIN TCP após um bloco gzip real → \`IncompleteRead\`; (3) socket configurado com \`SO_LINGER\` para RST após um bloco → \`ConnectionResetError\`; (4) half-open de leitura temporizado → \`TimeoutError\`. Todas classificadas como incompletas e **NUNCA repetidas automaticamente**. Token inválido → HTTP 401 em uma tentativa, zero corpo, sem retry. Apenas GET que recebe HTTP 503 transitório é repetido e recuperado exatamente na segunda tentativa com corpo gzip completo e SHA-256 verificado. Falhas são provocadas em processo de servidor HTTP real no localhost, e não imagens ou objetos Storage.

**Revogação comercial/JWT-RLS sintética entre blocos:** compressed payload propositalmente **442.825 bytes**, garantindo múltiplas escritas tanto em 64 quanto em 256 KiB. Após primeiro bloco autorizado de 65.536/262.144 bytes, transação SQL é concluída, revogador recebe lock PostgreSQL exclusivo e confirma revogação, servidor tenta continuação, falha na nova verificação de associação sob RLS e trunca a resposta. **Zero novas escritas do aplicativo após commit** em 12/12 jobs. No job de 300 clientes/pool12/256KiB, commit de revogação ~7,37ms; em toda matriz 7,37–11,15ms. A revogação subsequentemente gera HTTP 401 em nova requisição, sem retry; regrant sintético permite novamente o tráfego normal. **Bytes previamente enfileirados no kernel/proxy podem chegar depois do commit e isso não foi impedido nem comprovado ausente.**

**Pool e escala:** 8/12/20 conexões persistentes por processo e 100/300 requisições submetidas. Dois processos utilizam 16/24/40 conexões pré-abertas no total, fora conexões de teste e administração. Não significa 300 conexões PostgreSQL simultâneas, nem 300 TVs reais. Os relatórios da nova matriz contêm 10.000 eventos totalmente **sintéticos** e são validados por SHA-256; diferem do relatório comercial original, que é revalidado em outro workflow.

### Nova matriz — P95 / P99 HTTP real, incluindo contingência de rede

| Pool/processo | Bloco | 100 clientes P95 / P99 ms | 300 clientes P95 / P99 ms | GETs locais |
|---|---:|---:|---:|---:|
| 8 | 64 KiB | 1195,425 / 1264,925 | 2449,447 / 3063,816 | 109 / 309 |
| 8 | 256 KiB | 1279,086 / 1304,847 | 1473,035 / 2108,920 | 109 / 309 |
| 12 | 64 KiB | 1528,213 / 1877,455 | 1671,193 / 1883,441 | 109 / 309 |
| 12 | 256 KiB | 2099,963 / 2266,752 | **689,313 / 1118,977** | 109 / 309 |
| 20 | 64 KiB | 1564,065 / 1911,566 | 1947,914 / 2199,382 | 109 / 309 |
| 20 | 256 KiB | 1187,082 / 1232,795 | 1677,836 / 1869,902 | 109 / 309 |

Todos os cenários receberam 100/100 ou 300/300 HTTP 200 saudáveis completos após as injeções; falhas parciais foram contabilizadas como negativas independentes. Resultados vêm de runners diferentes, logo **não são comparação causal controlada de configurações**, nem garantia de P99 de TVs reais.

**SQL e GETs auditados:** 109/309 tentativas GET locais por caso = N saudáveis + 4 falhas de transporte + 1 JWT401 + 2 GET do retry503 + 1 GET interrompido na revogação + 1 nova requisição 401 após revogação. O contador de verificações SQL por admissão e bloco dos **N GETs saudáveis**, sem extras, foi corrigido para o limite inferior instrumental: **800/2400 verificações** (64 KiB) ou **300/900 verificações** (256 KiB) para 100/300 GETs respectivamente. Isso não mede todos os SQL statements de SET LOCAL, lock, claims, outbox, criação de pool, RLS e administração. O contador de SQL de outras suítes de relatório comercial é distinto.

### Consumo medido e limites

- Nova fixture de transporte: DB PostgreSQL17 **7.763.635 bytes**, índice RLS de associação **16.384 bytes**, WAL incremental após fixture geralmente **215.776 bytes** (houve uma execução com 5.000 bytes, por isso a variação não representa um efeito causal); RAM RSS do PROCESSO PRINCIPAL 100 clientes **102.076–153.584 KiB**, 300 clientes **120.332–210.628 KiB**, excluindo RSS das duas instâncias, PostgreSQL e cache do kernel.
- Novo gzip sintético: **442.825 bytes por relatório**, total **44.282.500 bytes** para 100 GETs completos, **132.847.500 bytes** para 300. Não inclui respostas de erro, retransmissões TCP, SSL ou vídeo. Zero GETs de mídia real.
- Regressão comercial original independente: banco com 20.664 eventos sintéticos **~21,99–22,00 MB**, índice de histórico **9.805.824 bytes**, WAL incremental após carga inicial **~214–488 KiB**, worker HTTP ~66–68 MiB RSS e arquivos AES-GCM cifrados ~5,94 MB/processo. O gzip comercial COMPLETO original mede **351.751 bytes por relatório**: 300 relatórios **105.525.300 bytes**. Seis estágios 100-old/100-new/100-rollback tiveram **300/300 HTTP 200 íntegros em cada job**.
- No teste comercial de alteração durante 300 clientes ao mesmo tempo, houve **293/300 HTTP 200 com hash e revisão válidos, 7 HTTP 503 fail-closed**, sem resposta incompleta classificada como sucesso. Os 503 existem no backend e tornam a disponibilidade contínua **NO-GO**. Esta onda particular não é a mesma suíte de GET simples que passou 300/300.
- Cenário AES manifesto remoto simulado de fixture pequena, recuperação após falha e hash, não acessa storage de TV. GETs/PUTs são da simulação, e **GETs de mídia reais não foram medidos**.

### Revalidação de AES, outbox e escrita após commit

A regressão independente 7/7 executou PostgreSQL17 descartável e validou: três injeções de crash (após primeiro rename, segundo rename, após publicação do manifesto antes do COMMIT SQL), conexão PostgreSQL local recusada mantendo PREPARED, recuperação por processo separado carregando chave SINTÉTICA de arquivo privado 0600, recibo COMMITTED e SHA dos quatro arquivos; outbox durável multiprocesso e checkpoints idempotentes; AES-GCM manifesto HTTP simulado e cold 100/300; e **0 bytes novos escritos após COMMIT** nas duas variantes de bloqueio SQL por bloco (64/256 KiB), com fonte e cache AES cifrados, symlink/alteração detectados e descritor memfd selado. A versão de teste contém chave-mestra sintética, **não é KMS/segredo real seguro**.

### Custos modelados, NÃO faturamento do Supabase

Assumindo somente **um relatório por cliente por dia e 30 dias**, excluindo mídia, heartbeat, chamadas extras, erro, retries, vídeo, imagens e custos de armazenamento:
- Nova fixture 442.825 bytes: 100 clientes / 3.000 relatórios = **1,328 GB gzip/mês**; 300 / 9.000 = **3,985 GB/mês**.
- Relatório comercial original 351.751 bytes: 100 = **1,055 GB/mês**; 300 = **3,166 GB/mês**.
- Modelo SQL comercial histórico: com blocos 64 KiB, aproximadamente **322.800** comandos para 100 ou **622.800** para 300 clientes por 30 dias; com 256 KiB **238.800/370.800**. Estas estimativas incluem um polling OPCIONAL de 2 réplicas a cada 30s (172.800 sondagens/mês), não ativado na nova suíte. Não substituem monitoramento de pg_stat_statements, billing nem testes de 30/90 dias. Plano Supabase Free e custos monetários em reais: **não avaliados**, porque o projeto oficial não foi acessado.

### Bloqueios permanentes — PRODUÇÃO NO-GO

1. **Deadline de decisão ≠ deadline físico.** Admission epoch impede novas rotas antigas mesmo com agendamento real atrasado >420ms; não força buffers, sockets ou download ativo a terminarem antes de 420ms. Nenhum SLA físico rígido comprovado.
2. **Revogação de escrita ≠ revogação de bytes já entregues.** Sob escritores cooperantes, 0 novas chamadas de escrita depois do commit; os bytes anteriormente aceitos pelo kernel podem ser entregues depois. Privilégios reais, SECURITY DEFINER e revogadores oficiais não foram auditados.
3. Quedas FIN/RST/half-open e header-only provocadas no localhost de processos distintos do **MESMO CI HOST**, não dois hosts físicos, nem proxy comercial real, link móvel, TLS, half-open prolongado ou video TV.
4. Regressões incluem PostgreSQL17 local e JWT/roles sintéticas. Nada prova limites reais Supabase, Auth/JWKS, KMS, armazenamento de mídias, streaming de TVs, custos em R$ e retenção mensal.
5. Durante uma alteração comercial simultânea, existem HTTP 503 fail-closed, e a política de retry cliente não garante zero indisponibilidade fora da bancada; deploy continua explicitamente vedado.

**Nenhum Supabase oficial foi sequer consultado. Nenhum APK, painel, site, Vercel, TV, históricos reais, branch de produção ou banco oficial foi alterado. Nenhum deploy.**
