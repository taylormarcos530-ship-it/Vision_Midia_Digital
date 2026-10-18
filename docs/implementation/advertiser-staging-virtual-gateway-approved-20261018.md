# Vision Mídia Digital — aceitação final da TV virtual autenticada (18/10/2026)

## Resultado: PASS em homologação remota

O Master exibiu **APROVADO** ao executar `Testar entrega à TV virtual e relatório`, confirmado pelo usuário. Esse resultado veio após corrigir duas falhas reais na limpeza do banco:
- O trigger de imutabilidade barrava a exclusão de revisões fictícias.
- A trigger executada pelo backend com `service_role` não tinha permissão de SELECT no guard do staging. Foi ajustada para `SECURITY DEFINER` com proprietário `postgres`, conservando a restrição a revisões de laboratório. Validado por transação como `service_role`, sem permitir UPDATE ou exclusão de revisões de campanhas normais.

**Evidências verificadas na nova execução:** Supabase `jmiuitrrhtaeyrpuyohk`, logs de 18/10/2026 entre 14:56 e 14:57 UTC:
- `commercial-virtual-gateway`: uma solicitação com credencial inválida rejeitada com HTTP **401**; chamadas seguintes de entrega e eventos responderam HTTP **200**.
- `master-admin`: requisições do ensaio responderam HTTP **200**, sem falha 503 na execução mais recente.
- Interface Master: PASS do fluxo fictício, incluindo anúncio intercalado, imagem real por URL assinada, 4 eventos simulados, 2 conclusões válidas sem duplicação e rotina de limpeza.

**Consulta ao banco após a execução (14:57:29 UTC):**
- `companies=0`, `devices=0`, `media_assets=0`, `playback_logs=0`, `vision_commercial_revisions=0`, `vision_commercial_targets=0`, `vision_commercial_daily=0`, `storage.objects=0`.
- `vision_commercial_campaigns=2`; `LAB-VIRTUAL-* = 0`; `vision_advertisers=3`.
- `vision_menu_lab.vision_menu_drafts=1`, preservado.
- O esquema/banco alvo foi confirmado como `jmiuitrrhtaeyrpuyohk`.

**Regressão do código do estágio:** `704/704 PASS` no commit anterior `e57f95c`. Este documento não altera lógica operacional.

## Escopo encerrado

A homologação técnica da distribuição **virtual autenticada**, cópia/leitura de arquivo em Storage de testes, proteção da programação base, telemetria fictícia e relatório isolado está concluída. **Não repetir** esse ciclo de homologação sem evidência de nova falha.

## Limite explícito: NÃO é liberação de produção

- A TV **Life fundo** da Academia Life **não participou** desse ensaio. Seu player oficial, playlist de 6 mídias e dispositivo não foram alterados.
- Não foi feita implantação no gateway de produção ou no APK físico; não se comprovou reprodução comercial em hardware real.
- A produção Vercel continua no commit `921f365b7f1ee5c7da7c96b74b3cdf1462e180c3`.
- Proibidos deploy/merge/migrations comerciais de produção ou acionamento remoto de TV real sem autorização específica, depois de apresentar plano de piloto, preservação da grade e retorno ao estado anterior.

**Próxima fase única:** piloto físico controlado no equipamento Life fundo com operador presente, janela autorizada, backup/configuração, critérios de sucesso (intercalamento sem alterar playlist original, retorno normal do player, métricas separadas) e procedimento de rollback. Até obter autorização, apenas planejamento/read-only.
