# Vision V30: Retenção segura de reproduções (isolada)

**Estado:** código em branch de homologação, SEM deploy, SEM limpeza.

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
4. Validar a deduplicação de `client_event_id` **depois** de os eventos originais serem removidos. O índice único atual só evita duplicação enquanto `playback_logs` guarda o evento. Este SQL não soluciona reenvios extremamente tardios. **A limpeza não deve ser habilitada até essa garantia existir.**
5. Verificar a permissão de empresa e usuário, e a correspondência de relatórios no ambiente de testes.
6. Medir o custo da função e do tamanho do banco em ambiente isolado. `DELETE` não devolve automaticamente o espaço físico ao sistema; `VACUUM`/manutenção exigem análise própria.
7. Somente após testes, aplicar SQL em produção, atualizar painel para o novo RPC e habilitar compaction explicitamente em operação supervisionada. Não alterar `get_playback_report` até a validação.

## Teste local (sem Postgres e sem produção)

`node --test tests/playback-compaction-v30.test.cjs`

Esses testes são de invariantes de código e uma simulação de consolidação, **não** são teste de execução SQL em Postgres. Antes de qualquer deploy, é obrigatório validar SQL em um PostgreSQL isolado.