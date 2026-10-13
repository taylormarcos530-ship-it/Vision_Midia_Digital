# Portal do Anunciante — execução incremental

Base: `4fd78802fc9ae4f8840fbfa1514cf9f467aaf39e`, que preserva a produção `921f365` e o ensaio independente de captura. Branch: `feat/advertiser-transparency-portal`.

Especificação: solicitação e confirmação de 13/10/2026. Master administra anunciantes e campanhas comerciais; anunciante somente lê seus dados; donos dos pontos permanecem no fluxo atual. Nenhum deploy de produção, migration remota ou Edge Function publicada nesta etapa.

## Contratos

- Novas tabelas `vision_advertisers`, `vision_commercial_campaigns`, `vision_commercial_revisions`, `vision_commercial_targets`, `vision_commercial_daily`. RLS habilitada; escrita apenas por RPC autorizado/Master backend.
- Revisão possui UUID próprio usado como `media.id` no manifesto. O evento existente grava esse UUID em `playback_logs.media_id` (sem FK nessa coluna). Não inferir campanhas por nome/arquivo/horário; troca de mídia gera nova revisão, preservando campanha.
- Gateway só acrescenta itens ao manifesto em memória, nunca grava playlists. Feature flag desligada por padrão. Falha comercial devolve programação original.
- Sem alteração no player/APK. Exigir suporte já existente a agenda por item. Modos shuffle/single e playlists com agenda por item ficam sem inserção nesta versão para preservar comportamento e evitar anúncio sozinho fora da agenda da base. Master recebe motivo explícito.
- Eventos concluídos contam como exibições; eventos não concluídos são tentativas, não comprovação de início visível. Offline não gera números por estimativa; eventos locais podem chegar após reconexão.
- Consolidação diária idempotente reutiliza logs e não duplica eventos. Sem exclusão dos logs existentes: retenção compartilhada exige política separada para não apagar relatório atual. Não há novo fluxo de telemetria.
- Portal via RPC com auth.uid verificado e projeção mínima; novas políticas não ampliam acesso às tabelas operacionais. Miniaturas por autorização restrita no Storage.
- Usuário anunciante novo via Supabase Auth, sem vínculo de empresa/plataforma. Redefinição somente desse usuário, senha não armazenada em tabelas nem logs.

## Etapas / testes

1. Testes Node e PostgreSQL local (PGlite) falham primeiro: intercalação preserva ordem, falha fechada, RLS A/B, desativação, tentativas, replay idempotente, revisão mantém histórico. Implementar SQL revisável sem executar no remoto.
2. Master e portal separados, REST Auth existente, renovação de sessão, senha temporária e troca de senha; navegação exclusiva Master. Testar entrada/saída, negação e mobile.
3. Hooks mínimos no gateway e master-admin, com helper isolado; executar suite completa e inspecionar diff dos arquivos existentes.
4. Revisão independente, preview sem produção, registrar o que foi executado e o que exige ambiente Supabase de homologação.

## Riscos a testar

Deduplicação de batches, mídia excluída/trocada, anunciante desativado com JWT ainda válido, tentativas sem conclusão, fila offline atrasada, indisponibilidade das novas tabelas, modificação da programação por shuffle/single/agendas, vazamento por consulta direta e URLs assinadas.

## Registro

- Base: 81/81 testes existentes passaram antes dos patches.
- Decisão: não reaproveitar `campaigns`, cujas políticas e prioridade pertencem ao dono do ponto.
- Decisão: banco local de teste, sem criar anunciantes nem campanhas em produção.
