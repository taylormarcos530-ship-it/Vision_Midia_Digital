# Vision V30 — Ledger em segmentos pequenos: homologação (31/10/2026)

**Status: PASS em PostgreSQL 17 descartável; ainda NÃO implantado em produção.** 
Branch: `fix/playback-daily-retention-safe-20261030`. Base indicada pelo usuário: `3f50a3faa06afd1033f29e61b467a2c33dec4544`.

## Evidência executável

- GitHub Actions 41200627568: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41200627568
- Commit corrigido e aprovado: `b271808526e34379c1b2c9e26417f3e35415a553`.
- Uma execução inicial 41200551888 falhou por sintaxe `pg_catalog.least`; substituída por `LEAST` na branch. A execução seguinte foi aprovada.
- Arquivo QA: `supabase/qa-migrations/v30_playback_segmented_ledger_qa.sql`. Segmentos de 64 fingerprints SHA-256 truncados para 16 bytes, indexados por TV, byte inicial de hash e número do segmento.
- Gatilho `BEFORE INSERT` rejeita reenvio se identidade já estiver no ledger, antes da contagem comercial; mesma trava transacional por TV usada pelo arquivador para impedir corrida.
- Não há cron, limpeza automática, alteração de APK ou importação de dados reais. A compactação permanece desabilitada por padrão.

## Benchmark executado no mesmo workflow

| Métrica em Postgres17 descartável | UUID original | blob grande por shard | Segmentos de 64 hashes |
|---|---:|---:|---:|
| Tabela+índices após 300 mil novas identidades (ambiente com 8 mil IDs de QA nas variantes compactas) | 25.051.136 B | 8.101.888 B | **6.733.824 B** |
| Inserção em lote 100 mil | 433,53 ms | 264,9 ms | 562,4 ms |
| Inserção adicional 200 mil | 959,27 ms | 635,0 ms | 4.375,0 ms |
| Mil leituras (500 presentes+500 ausentes) | 6,81 ms | 23,77 ms | 36,12 ms |
| 500 inserções unitárias após 300 mil | 16,84 ms | 204,73 ms | **71,83 ms** |
| Crescimento físico decorrente das 500 inserções | 32.768 B | **10.223.616 B** | **155.648 B** |
| WAL estimado nas 500 inserções | não medido | 6.304.456 B | 91.568 B |

Comparado ao blob monolítico, os segmentos reduziram crescimento físico durante 500 inserções individuais em aproximadamente **98,48%** e duração de gravação em aproximadamente 64,9%, ao custo de buscas ~52% mais lentas. Em relação ao ledger UUID por linha, o segmento ainda tem consultas e escrita unitária mais lentas, mas ocupa menos espaço. A carga por lote de 200 mil é mais lenta porque a implementação verifica cada hash nas estruturas atuais; pode exigir mais otimização de ingestão. Os números incluem efeitos de páginas e bloat; projeções não garantem a mesma performance em produção ou em dezenas de TVs simultâneas.

## Retenção por recebimento + integridade

- 8.000 eventos recebidos há 8 dias compactados em 17 lotes, 2 grupos no resumo.
- 2.000 eventos recebidos há 3 dias, embora exibidos há 31 dias, preservados.
- 100 eventos com relógio futuro também preservados.
- 5 relatórios sintéticos, inclusive por TV e anunciante, idênticos antes/depois: 10 mil eventos reportados.
- Duas sessões PostgreSQL concorrentes: uma compactação, zero reenvios duplicados aceitos, fingerprint mantido.
- Teste de reenvio antigo com data de exibição adulterada: recusado.
- Nota de precisão: hash de 128 bits fornece risco de colisão desprezível, mas **não é equivalência matemática perfeita com retenção de IDs completos**. A promessa de deduplicação estritamente sem colisões exigiria a identificação original.

## Backup/restore (apenas DB sintético)

- PG17 `pg_dump` formato custom, 12.132.318 B, SHA-256 `dfc444e12ce992dd687501d917a917da52c127bd51c4e632930cbe731e89b07c`.
- `pg_restore` em outro PostgreSQL descartável: sucesso.
- Ledger íntegro (5.329 segmentos, 308.501 IDs, hash dos blobs conferido).
- Resumo íntegro (3 grupos, 8.001 iniciadas, 8.001 concluídas; a execução de concorrência adicionou 1).
- 2.100 linhas brutas preservadas.
- Reenvio histórico rejeitado após restauração.
- Esse backup não contém informações reais e **não substitui** backup criptografado e restauração do projeto Supabase antes de uma implantação.

## Segurança de implantação e rollback — pendências

1. Revisar permissão do gatilho `SECURITY DEFINER`, grants, RLS e isolamento de empresas em ambiente com autenticação real.
2. Validar a ingestão no gateway com a mesma transação de contagem comercial. Garantir que o API retorne confirmação idempotente em reenvios ignorados, sem reenviar indefinidamente.
3. Testar com cargas progressivas de múltiplas TVs, 64/65 hashes por segmento e desempenho por dia em janelas de funcionamento; a variante segmentada tem custo maior de busca e carga em lote.
4. Validar histórico por mídia/anunciante/TV e exportação individual do Master; após retenção, o export bruto antigo inevitavelmente não recupera os eventos individuais, apenas totais.
5. Backup real externo criptografado e restauração comprovada, plano de rollback considerando linhas já consolidadas.
6. Habilitar compactação e agendamento **somente mediante autorização específica**; antes disso, não alterar produção, Vercel, TVs nem APK.
7. A deduplicação sem expiração ainda acumula ~16 B por identidade, mais overhead/indexação; Free não comporta crescimento ilimitado.

**Decisão:** segmentação é um avanço comprovado em laboratório para corrigir write amplification, mas o projeto ainda não está pronto para limpeza automática em produção.
