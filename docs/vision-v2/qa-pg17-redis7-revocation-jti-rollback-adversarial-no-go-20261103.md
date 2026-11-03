# Vision V2 — auditoria adversarial PG17/Redis7 e correção experimental de JTI

**Execução:** 03/11/2026 UTC. **Branch:** `experiment/vision-v2-toctou-continuous-guard-qa-20261102`. **Origem preservada:** `7c485b5b113d1493124f75e230e0dce990ef3192`.

**Veredito: testes de contraprova PASS; segurança geral FAIL/NO-GO.** Esta rodada não integrou APK, não publicou sistema nem utilizou serviços/dados oficiais. PostgreSQL 17 e Redis 7.4 exclusivamente descartáveis no GitHub Actions, WSS TLS com certificados locais sintéticos. `QA_STREAM_GUARD_GROUP=1`; drain desligado. Todos os testes anteriores, incluindo a contraprova TOCTOU do protocolo antigo, ficaram preservados.

## Evidências verificadas de CI

| Teste | Workflow | CI | Resultado de segurança |
|---|---|---|---|
| Regressão do gate contínuo após injeção de atraso TCP | [41621672460](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41621672460) | 4/4 PASS | PASS apenas na corrida originalmente reproduzida; revogação com prazo não comprovada |
| PostgreSQL17: HTTP FIN/RST/half-open, real TCP lento, lock_timeout e SIGKILL | [41622190015](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41622190015) | 2/2 PASS de contraprova | **FAIL**: deadline de 750 ms não conclui revogação |
| Redis7 dual authority WSS real, outage e rollback sintético | [41622123827](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41622123827) | 1/1 PASS de contraprova | **FAIL**: duplicação JWT entre Redis independentes + replay após perda do Redis |
| Redis WSS regressão após inclusão da correção experimental | [41622559375](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41622559375) | 1/1 PASS de contraprova | FALHAS anteriores preservadas, não corrigidas no gateway original |
| Candidato JTI global em PG17, duas instâncias WSS e dois Redis independentes | [41622629341](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41622629341) | 1/1 PASS | Corrige replay entre os dois Redis **somente enquanto um PG17 comum mantém o registro único**. Rollback conjunto SQL+Redis **FAIL reproduzido** |
| Antigo TOCTOU vulnerável sem alterações | [41556405244](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41556405244) | 2/2 PASS de contraprova histórica | **FAIL**: HTTP 200 após COMMIT de fechamento na versão antiga |

A palavra **PASS** nos workflows negativos significa apenas que o teste produziu o contrafactual de segurança esperado; nunca significa autorização de publicação.

## PostgreSQL: revogação com prazo — falha comprovada

Todos os cenários usam um PostgreSQL 17 real descartável e duas instâncias reais do proxy em subprocessos OS separados no mesmo runner, não dois hosts físicos.

| Pool total | Bloco | Timeout writer com pausa pós-gate | Timeout com leitor TCP lento | SIGKILL libera lock | FIN/RST/half-open |
|---:|---:|---:|---:|---|---|
| 8 | 64 KiB | ~759,9 ms, **sem COMMIT** | ~761,1 ms, **sem COMMIT** | ~35,4 ms até COMMIT após morte do detentor | 6/6 HTTP 503 |
| 12 | 256 KiB | ~760,6 ms, **sem COMMIT** | ~760,9 ms, **sem COMMIT** | ~20,2 ms até COMMIT após morte do detentor | 6/6 HTTP 503 |

- Com `lock_timeout=750ms`, o PostgreSQL interrompe a tentativa de obter lock exclusivo, **não força a revogação**. O gate permanece aberto. A requisição pausada prossegue com HTTP 200 quando liberada, provando que um timeout no escritor não resolve a propriedade desejada.
- O cliente TCP real com janela de recepção pequena deixou de consumir o corpo de resposta. A escrita no proxy ficou sujeita a backpressure enquanto a transação retinha lock compartilhado. O fechamento expirou; depois do RST do cliente, o detentor soltou lock e o COMMIT pôde ocorrer.
- `SIGKILL` real do processo detentor enquanto o escritor aguardava liberou as conexões PostgreSQL; o outro processo concluiu fechamento e as próximas requisições receberam HTTP 503.
- O experimento **não** valida um limite absoluto de revogação em redes reais ou bytes físicos TCP; a variante de lock contínuo **não é aprovada**. Nenhuma alteração foi feita no gate comercial antigo.

## Redis: falhas reais e contraprovas

Dois gateways WSS TLS locais em processos OS distintos e dois Redis7 locais independentes (portas 6379 e 6380), mesmo PG17 descartável de QA:

1. Reutilização de JWT no **mesmo** Redis: rejeitada (`JWT_REPLAY`); inquilino incorreto e token vencido rejeitados.
2. Mesmo JWT apresentado ao **outro Redis independente**: **aceito**, gerando dois leases distintos com heartbeats ACK. Esse é um modelo explícito de split-brain sem um fencing global, **não** um failover Redis HA/Sentinel real.
3. Redis primário parado com `docker stop` e restaurado com `docker start`: durante a parada, o gateway não emitiu `heartbeat_ack`; enviou erro. O gateway do Redis secundário continuou respondendo. Após restauração de estado apagado, um socket antigo não conseguiu novo ACK.
4. Após `FLUSHDB` no Redis primário com reconfiguração apenas do cadastro de empresa/dispositivo sintético, **o JWT previamente consumido foi aceito novamente**: replay distribuído sem registro durável.
5. Reuso de lease antigo contra um novo lease no **mesmo Redis** foi negado. Isto não protege o cenário dual-authority.

## Correção experimental: JTI único compartilhado no PostgreSQL

O candidato de QA gera uma cópia **temporária** do gateway WSS original no runner com apenas uma adição no login: inserir o JTI em `qa_wss.global_auth_jti`, tabela descartável com chave primária única, e rejeitar `JTI_GLOBAL_REPLAY` quando a linha já existe. A transação do INSERT confirma antes de enviar `ready`.

Provas em [41622629341](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41622629341):

- **PASS local:** com dois Redis independentes e requisições de autenticação concorrentes do mesmo JWT, exatamente **1/2** recebeu `ready`; o outro recebeu `JTI_GLOBAL_REPLAY`. Um único registro permaneceu após vários heartbeats. Nenhum INSERT por heartbeat é introduzido **na tabela de JTI**; o candidato faz uma gravação de autoridade por autenticação nova.
- **PASS local:** apagar somente Redis (`FLUSHDB`) não permitiu reutilizar JTI registrado no PG17. Ausência temporária da tabela de autoridade no PG17 impediu login (`fail closed`), em vez de emitir `ready`.
- **FAIL de segurança ainda reproduzido:** quando a linha de JTI em PG17 foi apagada e os dois Redis foram esvaziados em um ensaio de rollback lógico conjunto, **o mesmo JWT antigo foi aceito outra vez**. Não existe witness independente e não há comprovação de resistência a rollback conjunto. Não se testou restauração física de WAL/AOF/snapshot nem Redis Sentinel/Cluster.
- Limitações: conexão à tabela feita pela role PG privilegiada da fixture; identidade e RLS real do dispositivo não demonstrados. Taxa de crescimento, índices/retenção, transações abortadas, divergência entre regiões, PostgreSQL HA e custo operacional ainda não validados. O gateway produto não foi alterado.

## Ações ainda obrigatórias

1. Substituir o bloqueio de revogação durante resposta HTTP por protocolo com **fencing real por produção/artefato e deadline de cancelamento**, com garantias sobre respostas truncadas, cliente lento e writer legítimo sem COMMIT falhado. Exigir teste negativo de qualquer liberação insegura.
2. Provar um único emissor/fencing global durável com autonomia adequada e recuperação após rollback conjunto, PG failover, Redis HA/partição, duplo writer e replay após reinício. O registro PG de JTI é somente **candidato experimental**, não certificação.
3. Fazer autenticação real por dispositivo/empresa, RLS e privilégios mínimos, medição de WAL/SQL/latência, backup/restore e integração ao APK de homologação separado.
4. Revalidar após qualquer correção as matrizes de capacidade WSS 100/300/600/1000 TVs e a reconstrução idêntica dos 10.090 comprovantes comerciais AES-GCM sem alterar o contrato do cliente.

**Status final:** CI negativo reproduziu falhas; candidato JTI local preveniu dois ataques restritos; segurança distribuída e disponibilidade de revogação continuam **FAIL/NO-GO**. Nenhuma produção alterada.
