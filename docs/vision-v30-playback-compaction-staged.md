# Vision V30: Retenção segura de reproduções (isolada)

**Estado:** código em branch de homologação, SEM deploy, SEM limpeza; PostgreSQL 17 sintético aprovado em 30/10/2026 (UTC: 31/10).

## Motivo

O histórico `public.playback_logs` cresce muito mais rápido que o banco Free.
O APK 1.5.24 reduz consultas, mas ainda envia comprovantes individuais.
As tabelas `playback_daily_summary` existentes estão antigas (últimos dados em 8/9/2026),
enquanto o esquema QA `vision_playback_snapshot_qa` comprovou paridade de totais
nos dias 23–28/10/2026.

## Como foi preparado

- Arquivo `vision_playback_compaction_v30.sql` cria **um arquivo diário complementar**, baseado nas dimensões já testadas no QA. Nenhum registro original é alterado pela instalação do SQL.
- O novo relatório RPC `get_playback_report_compacted_v30` lê **brutos + resumos**, com os mesmos campos principais que `get_playback_report`, sem substituí-lo.
- `private.vision_playback_compact_batch_v30` trabalha com **250 registros por lote (máximo 500)** e só poderá ser usado se habilitado explicitamente e com todas as validações registradas. Em uma mesma transação Postgres, `DELETE ... RETURNING` envia os eventos ao resumo; rollback impede perda parcial.
- O prazo de 7 dias usa `created_at` (**recebimento**) e não `started_at` (exibição). Eventos que chegaram atrasados não são excluídos cedo.
- Nenhum cron é instalado e não há alteração no APK ou no gatilho de `vision_commercial_daily`.

## Bloqueadores para ativar a limpeza

1. Criar um backup **externo, completo, criptografado e com restauração testada** antes de qualquer exclusão real.
2. Validar as contagens por empresa/TV/mídia/campanha, incluindo valores, taxas e nomes históricos (não apenas total global).
3. Verificar a exportação individual antiga: depois de compactar, `get_playback_events` só entrega eventos recentes; o Master deve identificar corretamente os períodos resumidos.
4. **FALHA COMPROVADA EM CI:** após excluir o bruto, a inserção de um evento já compactado é aceita pelo índice atual. A tabela de controle ganhou `dedupe_verified_at` obrigatório e sem valor padrão, portanto a limpeza permanece bloqueada mesmo com as demais aprovações. Implementar deduplicação durável e verificar custos de armazenamento, reconexões e concorrência antes de ativar. **Não habilitar limpeza.**
5. Verificar a permissão de empresa e usuário, e a correspondência de relatórios no ambiente de testes.
6. Medir o custo da função e do tamanho do banco em ambiente isolado. `DELETE` não devolve automaticamente o espaço físico ao sistema; `VACUUM`/manutenção exigem análise própria.
7. Somente após testes, aplicar SQL em produção, atualizar painel para o novo RPC e habilitar compaction explicitamente em operação supervisionada. Não alterar `get_playback_report` até a validação.

## Teste local (sem Postgres e sem produção)

`node --test tests/playback-compaction-v30.test.cjs`

Esses testes são de invariantes de código e uma simulação de consolidação, **não** são teste de execução SQL em Postgres. Antes de qualquer deploy, é obrigatório validar SQL em um PostgreSQL isolado.
## Evidências da homologação isolada (31/10/2026 UTC)

- 270 agrupamentos e 63.021 reproduções comparados em leitura com `vision_playback_snapshot_qa` contra o histórico original: **zero divergências** por empresa, TV, campanha e mídia; universo de 11 TVs/3 empresas em 23–28/10.
- 8 testes JavaScript executados em CI, 8 aprovados.
- PostgreSQL 17 descartável com fixture sintética e migração V30: PASS para dois anunciantes, duas TVs, relatório híbrido, retenção de eventos offline, bloqueio sem aprovação, repetição do lote, preservação da tabela comercial e controle de acesso simulado.
- **O cenário negativo de replay depois da exclusão foi reproduzido em CI.** A inexistência de deduplicação durável impede ativar compactação no projeto real.
- Execução de testes: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41152354204
- Segurança: nenhum acesso de CI ao Supabase, nenhum cron, deploy ou alteração do Player/APK.

## Próxima etapa obrigatória

Projetar/implementar mecanismo de idempotência persistente econômico (sem recriar crescimento de storage no Free), testar race conditions em PostgreSQL descartável, conferir reenvios muito tardios e validar números comerciais. Depois passar por aprovação de backup/recuperação e de testes de relatórios. **Somente então** considerar ativação.
