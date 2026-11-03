# Vision V2 — continuação TOCTOU com bloqueio contínuo (revisão experimental)

Data: 02/11/2026, execução CI registrada em 03/11 UTC.
Origem preservada: commit `7196587041395f083a8d0e10cb18da6c5fc09559`, branch `experiment/vision-v2-sequence-watermark-qa-20261031`.
Nova branch isolada: `experiment/vision-v2-toctou-continuous-guard-qa-20261102`.
Código testado: `95dfed81d2693882ee53452f57512a8674392f7a`.

**Segurança global/produção: NO-GO.** Não foram alterados Supabase oficial, Redis de produção, APK, painel, TV, site, Vercel, main, nem os arquivos da contraprova anterior. `QA_STREAM_GUARD_GROUP=1`; drain não habilitado.

## Evidências

- Workflow [41558520679](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41558520679): **4/4 PASS** no PG17 descartável, duas instâncias HTTP reais em subprocessos OS independentes no mesmo runner, cada uma com origem e proxy; matriz de 100/300 GETs HTTP com gzip e SHA-256 íntegros, RLS sintético, mudança de rota real, fechamento concorrente do gate, revogação da associação (401), limite de pools e ausência de conexões emprestadas ao fim.
- Contraprova anterior [41556405244](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41556405244): **FAIL de segurança ainda válido para o código antigo**, com 2/2 jobs verdes apenas porque *demonstraram* a vulnerabilidade. Ela foi preservada sem alterações.
- A versão corrigida em **cópia experimental** mantém `pg_advisory_xact_lock_shared(LOCK_GATE)` durante a decisão de autorização, escolha da rota, leitura da origem, validação de SHA e escrita do HTTP ao cliente. O fechamento pega `pg_advisory_xact_lock(LOCK_GATE)`, portanto não pode COMMITAR enquanto o HTTP autorizado ainda está na seção crítica.
- A barreira determinística da suíte comprovou um writer exclusivo **em espera real no `pg_locks`** durante a pausa pós-checagem, alteração da rota para a outra origem, liberação da requisição, HTTP 200 permitido e HTTP 503 em ambos os proxies após observar o COMMIT. **Não foi aferido o instante físico em que o cliente recebeu os bytes do HTTP 200 em relação ao COMMIT**: o teste mostra a ordenação da escrita de aplicação em relação ao lock, não revogação de buffers TCP. Não houve HTTP 200 novo admitido após o COMMIT no cenário instrumentado.
- Todos os checks do CI explicitam `production_GO=false`. Os 4 artefatos JSON/log foram carregados com retenção de 14 dias.

## Medições dos quatro jobs

| TVs | Pool total | Chunk | P95 ms | P99 ms | HTTP 200 íntegros | Guardas SQL explicitamente instrumentados | Egress de corpos HTTP (bytes) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 8 | 64 KiB | 993,064 | 1095,607 | 100/100 | 952 | 43.713.700 |
| 100 | 12 | 256 KiB | 688,337 | 1307,856 | 100/100 | 427 | 43.713.700 |
| 300 | 8 | 64 KiB | 840,367 | 1646,542 | 300/300 | 2752 | 131.141.100 |
| 300 | 12 | 256 KiB | 693,611 | 733,698 | 300/300 | 1227 | 131.141.100 |

Os percentis são do fluxo HTTP local de relatórios da nova suíte, não dos heartbeats WSS nem da internet das TVs; não comparar diretamente aos números WSS do relatório anterior. `WAL_end_lsn` foi registrado, mas a suíte não mediu `WAL_delta`; não inferir volume de WAL. SHA-256 do payload sintético integral desta suíte: `552f905e69b774f01a643f0b1e3980d0e90ab562494d7f815da50d2782bce4d3`.

## Riscos e condições obrigatórias

1. **Revogação sem deadline comprovado.** Manter o lock durante o envio inteiro causa bloqueio do writer enquanto o leitor está lento, atrasado, sem rede ou com socket preso. Nenhuma prova de P95/P99 de revogação sob clientes lentos, crash durante lock, partição ou adversário malicioso. Isto pode ser inaceitável como solução de produção, mesmo com TOCTOU de admissão corrigido na bancada.
2. O teste tem dois subprocessos no **mesmo runner e mesmo PostgreSQL**. Não comprova dois hosts, rollback simultâneo, DNS, falhas de Redis, split-brain ou propriedade de mensagens no TLS/wire.
3. Locks PG ordenam as *escritas de aplicação* na seção crítica, mas não recolhem bytes que já foram passados ao kernel/TCP antes do COMMIT. Nenhum compromisso de entrega física anterior ao fechamento.
4. Writer de banco, identidade real do dispositivo, token de produção, sessões Redis e APK não foram integrados a este reparo local. A vulnerabilidade original permanece válida no código antigo, que não foi modificado.
5. Os ensaios WSS do commit anterior, AES-GCM, 10.090 comprovantes e hashes comerciais seguem **preservados, não reexecutados aqui**. Não apresentar estes quatro jobs como nova homologação integral do WSS, nem como prova de que os relatórios oficiais foram migrados.

**Próximos ensaios:** (A) injetar cliente lento, FIN/RST, half-open e SIGKILL enquanto writer de revogação espera, com timeout explícito e teste de locks presos; (B) Redis failover/split-brain/AOF + replay/rollback de JTI e lease, duas autoridades separadas; (C) experimentar fencing por transação curta no produtor/artefato sem bloquear revogação em todo o download; (D) integração WSS com APK de homologação somente em ambiente separado. Nenhum deploy autorizado.

**Veredito: correção da corrida reproduzida nesta variante de QA = PASS LOCAL, segurança da arquitetura completa = NO-GO.**
