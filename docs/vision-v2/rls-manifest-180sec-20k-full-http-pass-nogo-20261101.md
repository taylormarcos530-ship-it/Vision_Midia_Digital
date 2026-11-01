# Vision V2 — QA de RLS, manifesto, partição de rede e 20K exportados

**Data:** 2026-11-01. **Branch experimental exclusiva:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Ponto inicial:** `f28f361a7ccb3c2bc6206f9ea72423e9d53772a1`.

**Veredito: PASS no QA isolado; GO apenas para continuar QA; NO-GO para produção.**

## Evidência primária: GitHub Actions

- [Run 41312787344](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41312787344): **PASS**, PostgreSQL 17 descartável, auditoria RLS de 8 tabelas, rollback de outbox, falhas no manifesto AES-GCM e **JSON integral por HTTP para 100 e 300 clientes**, commit `6dbcb1f4`.
- [Run 41312513819](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41312513819): **PASS**, dois namespaces Docker, backend desconectado por no mínimo 183 segundos de relógio real, lease 180 s, reconciliação 60 s, recuperação, commit `e74a154d`.
- [Run 41312613302](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41312613302): **PASS**, regressões sequência/offline.
- Iterações que falharam por instrumentação `41312436711` (relação outbox consultada antes de existir) e `41312550117` (a tabela qa_rpc.read_events é intencionalmente removida). Corrigidas apenas na branch de QA.

## Falha real encontrada na política sintética

**Antes de reforçar RLS no banco descartável**, revogação de associação ainda deixava visíveis ao usuário com JWT assinado: `public.companies` 1 linha, `devices` 3, `campaigns` 3, `playlists` 2, `media_assets` 4, `playback_logs` **10.332**, `qa_rpc.daily` 138 e `qa_rpc.pending_without_time` 1. Todas as 8 políticas originais conferiam apenas empresa, sem associação ativa. O teste aplicou apenas no PG17 efêmero a exigência de `private.is_company_member` em todas; após isso, consultas diretas do usuário revogado e de outra empresa foram negadas; RPC original também recusou revogação. `qa_rpc.read_events` permaneceu ausente (nenhuma cópia permanente adicional). **Essa evidência é do esquema sintético; não representa uma inspeção do RLS oficial.**

## Outbox e manifesto AES-GCM

Atualização de campanha, revisão e registro no outbox dentro de uma única transação PG17. Rollback forçado não deixou alteração parcial nem evento órfão. Depois do commit, um marcador `PENDING` impediu servir o manifesto até o arquivo criptografado estar corretamente publicado e o marcador `READY`/SHA256 persistido. Falhas de staging, corrupção e interrupção responderam 503; publicação íntegra recuperou. **O armazenamento de objetos usado foi um diretório local temporário, não um serviço externo; atomicidade entre PG e armazenamento remoto continua não comprovada.**

## HTTP: 20.000 eventos completos (10.000 por empresa)

Os RPCs originais, sem modificação, produziram report e export de **10.000 eventos por empresa**, mantendo 20.664 eventos sintéticos na origem. Dois processos independentes calcularam as quatro respostas frias, armazenaram o JSON integral em cache e **cada cliente HTTP recebeu o conteúdo completo**, com Content-Length e SHA256 conferidos, além de amostras deserializadas e contagem de 10.000.

| Clientes HTTP simultâneos | P95 | P99 | Egress real no loopback |
|---|---:|---:|---:|
| 100 | 116,616 ms | 129,518 ms | 279.351.000 bytes |
| 300 | 139,454 ms | 166,504 ms | 838.053.000 bytes |
| **Total** | — | — | **1.117.404.000 bytes** |

Foi medida **concorrência de leitura em cache quente**, não 300 reconstruções SQL simultâneas do relatório. Cada processo atingiu aproximadamente 61 MiB RSS, excluindo PostgreSQL e coordenação.

## Partição de backend >=180 segundos, relógio real

Dois contêineres em **namespaces Linux Docker diferentes no mesmo runner**. Cortou-se apenas a rede do backend da instância B, com HTTP frontend ainda acessível. A instância B recusou consultas com 503 ao vencer o lease de 180 s; a instância A permaneceu disponível. Após a reconexão, ambas alcançaram a revisão 2. O teste dormiu **183 segundos reais** antes da verificação de isolamento. O campo de log `actual_partition_wall_seconds=240.086` também inclui tempo posterior de recuperação e não representa a duração precisa da desconexão. P99 do JSON curto de estado: 9,246 ms/100 e 9,639 ms/300. **Não foram dois hosts físicos ou regiões diferentes.**

## Custo e limites — PG17 sintético, não faturamento Supabase

| Métrica | Valor |
|---|---:|
| Banco antes da expansão sintética | 8.861.363 bytes |
| Banco após expansão e QA | 21.903.027 bytes |
| Índices da origem antes/depois | 335.872 / 9.805.824 bytes |
| Índice do resumo diário | 16.384 bytes |
| Outbox com índices | 65.536 bytes |
| WAL **após a inserção dos 20 mil históricos** | 234.184 bytes |
| Tráfego do JSON completo 100+300 | 1.117.404.000 bytes |
| GET remoto de arquivo criptografado | Não medido (objeto QA local) |

Índices e outbox já estão incluídos no tamanho do banco. WAL acima **não** mede WAL da inserção dos 20.000 registros, pois a linha de base foi coletada depois dela.

Estimativa de projeto para mês de 30 dias: heartbeat **global** a cada 60 s = 43.200 operações; dois leitores de revisão a cada 60 s = 86.400; **129.600 operações totais** fora de relatórios, autenticação e retries. Não é consumo real nem custo em reais confirmado. Redução SQL no cache não elimina egress de grandes relatórios.

## Bloqueios para produção

1. Conferir políticas RLS reais para todas as tabelas e funções com autenticação Supabase/JWKS, expiração, revogação e troca de empresa.
2. Integrar outbox e publicação verificada em **armazenamento remoto** com crash/retry, KMS e versionamento de manifesto.
3. Validar dois hosts independentes e 100/300 **relatórios frios** sobre histórico realista, incluindo falhas durante transferência.
4. Medir custo do Supabase Free, WAL completo, memória PostgreSQL+gateway, índice, egress e retenção real.
5. Decidir se uma janela de até 180 s para bloqueio de revogação é aceitável; a cadência de 60 s não é homologação para produção.

**Nenhum Supabase oficial foi consultado ou alterado, nem APK, painel, site, TV ou histórico real. Sem deploy e sem merge na main.**
