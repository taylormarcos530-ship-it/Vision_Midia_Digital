# Vision V30 — teste de escala, retenção de 7 dias e recuperação (31/10/2026)

**Estado: homologação isolada; NÃO PUBLICAR.** Branch `fix/playback-daily-retention-safe-20261030`. Nenhum comando de escrita no Supabase de produção, nenhuma exclusão real, nenhum deploy Vercel de produção, nenhuma mudança no APK ou TV.

## Evidências

Execução completa: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41199092093

O CI usou PostgreSQL 17 descartável com dados **inteiramente sintéticos**. A suíte anterior de deduplicação e testes de concorrência continuou passando. A primeira tentativa de escala (run 41198854085) falhou por nome SQL ambíguo; a correção foi restrita a `tests/v30-packed-ledger-scale.sql`. A execução seguinte (run 41198944670) e a comparação com a versão antiga (run 41199092093) passaram.

### Retenção por recebimento, não por reprodução

- 8.000 eventos sintéticos mais velhos que 7 dias desde `created_at` foram compactados em 17 ciclos de até 500; dois grupos somaram 8.000 exibições.
- 2.000 eventos recebidos havia 3 dias, mas exibidos havia 31 dias, permaneceram no histórico bruto.
- 100 eventos com relógio futuro/suspeito permaneceram no histórico bruto.
- Relatório combinado total, por TV A/B e por anunciante A/B: **5 de 5 comparações idênticas** antes/depois; total de 10.000 reproduções para o dia de teste.
- Reenvio do ID arquivado, mesmo com `started_at` alterado em centenas de dias, foi bloqueado; contagem comercial sintética permaneceu igual.
- O mesmo conjunto de testes executou transações e tabelas somente no PostgreSQL de QA.

### Ledger: benchmark no mesmo CI

Unidades são bytes físicos de tabela + índices + TOAST; tempos se referem a ensaios sintéticos no runner, não latência real das TVs.

| Medida | Ledger anterior (UUID por linha) | Ledger compacto (bytea por dispositivo/shard) |
|---|---:|---:|
| Após ~100 mil novos IDs | 8.904.704 bytes para 100 mil | 2.850.816 bytes para 100 mil, além de 8 mil de QA anteriores |
| Após ~300 mil novos IDs | 25.051.136 bytes | 8.101.888 bytes, com 308 mil IDs totais |
| 1.000 consultas (500 presentes, 500 ausentes) | 7,47 ms | 26,87 ms |
| 500 inserções individuais adicionais | 20,14 ms | 278,92 ms |
| Crescimento físico das 500 inserções | 32.768 bytes | 10.223.616 bytes |
| Bytes físicos após 500 inserções | 25.083.904 bytes | 18.325.504 bytes |

**Achado crítico:** embora o bloco compacto reduza a ocupação inicial em aproximadamente 67%, sua estratégia atual atualiza e regrava uma coluna `bytea` cada vez maior. Isso causa *write amplification* e crescimento físico acentuado com escritas incrementais. Na retenção de sete dias, somente 8.000 IDs geraram uma tabela de ledger de 827.392 bytes (mais de 100 bytes físicos por identidade). A estimativa anterior de 20,88 bytes por ID feita com preenchimento em lote **não pode ser usada como previsão garantida para uma frota em operação**.

**Decisão de homologação: BLOQUEADO PARA PRODUÇÃO.** Não ativar compactação/limpeza nem confiar em projeções de 10/15/20 TVs até criar e testar uma estrutura incremental com blocos limitados ou segmentos imutáveis.

### Backup e restauração real, mas só de dados sintéticos

- `pg_dump` executado com cliente PostgreSQL 17 em contêiner, formato custom, backup temporário de 12.072.583 bytes.
- SHA-256: `b7c4cfdeef0cd006b36bf8bc4b0c1e055cbf9dc0cebd6130e12631adf0949ff5`; verificação do arquivo PASS.
- `pg_restore` para banco descartável separado PASS.
- Comparação do digest de todos os blobs de fingerprints e dos respectivos totais: PASS (`768` buckets, `308500` IDs no ledger compacto).
- Comparação de resumos de reprodução: PASS (`2` grupos, `8000` iniciadas, `8000` concluídas).
- Histórico individual preservado após restauração: PASS (`2100` linhas).
- Um reenvio antigo foi rejeitado no banco restaurado: PASS.
- Backup sintético foi excluído após teste. **Este teste NÃO é um backup criptografado do Supabase de produção.**

### Plano seguro de interrupção e recuperação — NÃO EXECUTAR EM PRODUÇÃO AGORA

1. Antes de qualquer implantação futura, fazer backup externo completo do PostgreSQL real, criptografado e com restauração demonstrada; registrar checksum, dimensões e contagem por cliente/TV.
2. Publicar eventuais funções/relatórios somente mediante autorização separada, mantendo `private.vision_playback_compaction_control_v30.enabled=false` e sem cron; primeiro comparar relatórios em paralelo, sem apagar linhas.
3. Em caso de comportamento anômalo, **desativar a compactação** e interromper qualquer agendamento, mantendo o trigger de deduplicação e os registros arquivados. NÃO remover ledger, arquivos de resumos ou o leitor híbrido se já existirem linhas compactadas.
4. Restaurar o painel para o código original só é seguro se não houve remoção de histórico bruto, ou se o painel antigo estiver preparado para ler o resumo. Caso contrário, manter o relatório híbrido e recuperar os dados brutos por um procedimento de restauração em ambiente isolado.
5. Para recuperar o banco original integralmente, restaurar um backup criptografado testado em instância separada, comparar dados com produção, planejar o replay de eventos após o backup e validar contadores antes de qualquer troca.
6. Não aplicar `VACUUM FULL`, `REINDEX`, `pg_repack` nem operações de recuperação de espaço em produção durante homologação; são intervenções com requisitos de bloqueio/armazenamento e testes próprios.

### Próximo trabalho técnico

Implementar variante **segmentada / append-only** de fingerprints (segmentos imutáveis e bloco ativo pequeno, com buscas completas por dispositivo/shard e bloqueio por TV), comparar com o ledger por linha e `bytea` monolítico em 100–300 mil IDs, provar testes de reenvio e concorrência e reduzir *write amplification*. Em seguida repetir a restauração sintética e avaliar custo operacional de 7 dias.
