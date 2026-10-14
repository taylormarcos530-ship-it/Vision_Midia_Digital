# Camada de campanhas comerciais — auditoria pré-ativação isolada

Checkpoint de origem: `93ac299e9999597511af03c962045c717b93bb49` (Vision Diagnóstico TESTE v0.5 homologado em celular).
Branch de testes: `fix/advertiser-portal-safety-20261013`.
Sem permissão para deploy de produção, mudança no player dos clientes, migração remota, alteração de playlists ou publicação de Edge Functions.

## Objetivo do contrato

- A mídia do ponto deve permanecer completa, na mesma ordem, e cada item base deve preservar seus identificadores, duração e agendamento.
- A camada comercial é **aditiva, opcional e independente**: usa as tabelas e revisões `vision_commercial_*`, não reaproveita `campaigns` do ponto.
- Não gerar programação somente comercial para TV sem playlist; mostrar "Aguardando playlist".
- Em indisponibilidade comercial, manter a programação base intacta. Não alterar fallback, player operacional ou logs originais.
- Não computar exibições por tempo decorrido ou por simples inserção no manifesto. Somente eventos reais de conclusão podem contar.

## Arquivos inspecionados nesta rodada

- `supabase/functions/_shared/commercial.mjs`: `commercialEligibility`, `interleave`, `cycleCommercialSelection`, `augmentCommercial`, `decorateCommercialRows`.
- `supabase/functions/device-gateway/index.ts`: chamada opcional a `augmentCommercial` dentro do manifesto, depois de resolver a programação base, protegida por `Deno.env.get('VISION_COMMERCIAL_ENABLED') === 'true'`.
- `supabase/functions/master-admin/index.ts`: ações `commercial_*` bloqueadas quando a mesma variável não está habilitada.
- `commercial-config.js`: interface desconectada por padrão (`enabled:false` e URL/chave vazias).
- `commercial-tv-bench.mjs`, `commercial-tv-auto-state.mjs` e respectivos testes: bancada desconectada da produção.
- `supabase/sql/advertiser-portal.sql`: script revisável das tabelas/RPCs comerciais; **não executado em produção** nesta rodada.

## Resultado dos testes acrescentados

Foi criado **somente** `tests/commercial-gateway-safety-audit.test.cjs`, com seis testes novos (mocks locais, sem rede):

1. Feature flag desligada: zero chamadas RPC/Storage e retorno da playlist original.
2. Sem playlist ou playlist vazia; shuffle, single, agendamento por item, player legado e timezone não elegível: nenhuma consulta ao manifesto nem Storage.
3. Falha de assinatura de mídia comercial: retorno exato da programação base e sem mutações.
4. Assinatura parcial: inserir apenas o comercial disponível, preservar mídia e fallback do ponto, informar diagnóstico `media_unavailable`.
5. Nenhuma campanha comercial ativa: manter a playlist original e diagnosticar `no_active_campaign`.
6. Verificação estática dos bloqueios no gateway e da configuração desabilitada.

CI de segurança passou no commit `deaf06aab917790e1c35b26c988963830ebea35c`:
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38638880766

## Lacunas que impedem afirmar operação comercial completa

- **Rotação justa de vários anunciantes não implementada no gateway real por rodada.** `cycleCommercialSelection` aceita um índice de rodada na bancada, mas `augmentCommercial` chama `interleave(primary,ads)` sem índice; no runtime a seleção permanece na rodada 0 e, quando há mais anunciantes que vagas, os restantes podem nunca ser escolhidos. Não prometer entrega equilibrada sem projetar uma estratégia de ciclo com estado confiável, sem mudanças no player oficial.
- O teste nativo v0.5 no celular valida apenas mídias fictícias locais; não valida Auth, Storage, RPC, sinais de entrega, campanhas reais nem capacidade de uma TV Box Smart Pro 3000.
- É necessário um Supabase **isolado** com o esquema e RPCs para homologação ponta a ponta, incluindo permissões do bucket, mídia removida, campanhas desativadas, RLS A/B e reconciliação dos logs sem duplicidade. A presença de configuração de staging no repositório não é prova de que todos esses cenários foram homologados.
- Atualização de manifesto durante a execução, condições de erro de codec, duração real, agendamento no player e transições com campanhas atuais ainda exigem validação fora da produção.
- Até essas validações, não alterar o gateway/protocolo de eventos, o APK dos clientes nem a fonte de dados de produção.

## Próximo bloco recomendado

Projetar e testar **somente em biblioteca/bancada isolada** uma política determinística de distribuição dos anúncios quando existem mais anunciantes do que espaços, incluindo interrupções e alterações de campanha entre rodadas. Preservar as regras atuais de retorno à playlist original e aguardar autorização separada para qualquer futura integração ao gateway produtivo.
