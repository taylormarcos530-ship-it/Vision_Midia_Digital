# Checkpoint — contrato offline de recibos comerciais (pré-staging)

**Base preservada:** `6c62648398902d73fad844d1f09694f4a0150d9d`.
**Branch:** `fix/advertiser-portal-safety-20261013`.
**Escopo:** somente biblioteca, testes e documento isolados, sem conexão real, deploy ou migração.

## Entrega

- `commercial-staging-receipt-lab.mjs`: simula um servidor autoritativo **apenas em memória**, com TV, empresa, revisão da playlist/atribuição, inventário comercial, capacidades do player, ocorrências e recibos fictícios.
- `tests/commercial-staging-receipt-lab.test.cjs`: valida programas incompatíveis, anúncio ativo/segmentado, ID de ocorrência, duplicações, cancelamentos, relógio, expiração, lotes e consolidação por dia.
- Apenas TV com playlist, programação compatível e revisão comercial ativa destinada a ela recebe ocorrência fictícia. TVs legadas, sem playlist, shuffle, modo único e agenda individual preservam integralmente o conteúdo base.
- Um `client_event_id` já aceito pode ser reenviado sem contabilizar novamente. IDs colidindo com payload diferente ou eventos diferentes para a mesma ocorrência finalizada são rejeitados.
- Eventos incompletos contam só como tentativas. Toda declaração `completed:true` deve indicar `ended_at` RFC3339 dentro do período válido; **isso não prova exibição física real**.
- Republicar programação invalida ocorrências não finalizadas da configuração antiga; eventos já aceitos permanecem registrados para deduplicação.
- Resumos são recalculados do ledger de registros aceitos; tentativas de fraude/duplicação não aumentam o total. Os dias desta bancada seguem **horário de chegada ao servidor em America/Sao_Paulo** e não se confundem com dia de reprodução real.

## Código existente consultado, não modificado

O `device-gateway/index.ts` operacional aceita `playback` e `playback_batch`, com limite de 100 eventos, e já grava usando `upsert(...,{onConflict:'device_id,client_event_id',ignoreDuplicates:true})`. A rotina SQL `vision_commercial_refresh_daily` calcula tentativas e conclusões por revisão/TV/dia com base no `playback_logs`. **O laboratório não substitui nem modifica essas estruturas.**

## Limites obrigatórios antes de eventual implementação real

1. Identificadores da TV devem vir de autenticação validada pelo servidor, não de um campo controlado pelo aplicativo; nesta bancada isso é somente um contexto fictício passado aos testes.
2. O ID de ocorrência/lease **não é assinado, secreto ou inforjável**. Nenhum resultado prova que um vídeo realmente foi visto até o fim. Relatórios comerciais auditados exigem validação e política de aferição próprias.
3. A idempotência é serial em memória. Uma integração PostgreSQL precisaria usar restrições únicas e transações atômicas para `(device_id,client_event_id)` e `(device_id,occurrence_id)` contra recebimento simultâneo. **Não criar migrations agora.**
4. A bancada recusa primeiro envio após expiração de até 5 minutos; não foi homologada entrega offline prolongada nem definição do dia de faturamento quando a TV ficou sem rede. O SQL atual usa dia da reprodução, ao contrário do recibo simulado por chegada.
5. Alterações e revogações simultâneas exigirão publicação autoritativa de versões, relógio do servidor, reconciliação e estratégia de rollback; versões antigas do APK devem permanecer no protocolo atual, sem regredir playlists.
6. Não alterar `player.js`, `android-player/`, `device-gateway/index.ts`, playlists, Supabase/Edge Functions de produção, serviço de anúncios do cliente ou fazer deploy. Não ativar flag comercial.

## Próximo checkpoint

Auditar casos adversariais e desenhar o plano de staging/rollback **somente em documento/testes**, antes de autorização explícita para qualquer integração a dispositivos ou infraestrutura.
