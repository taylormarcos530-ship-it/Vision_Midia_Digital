# Vision Mídia Digital — plano de piloto físico Life fundo (sem alteração de produção)

**Data da verificação:** 18/10/2026. **Status: planejamento técnico concluído; execução física NÃO autorizada nem realizada.**

## Estado operacional comprovado por leitura

- A TV `Life fundo` na Academia Life responde ao heartbeat, com Player `vision-player-web-1.5.11`, playlist com **6 itens habilitados** e logs de reprodução concluída na última hora. Isso comprova conectividade e registros, não a visualização física do conteúdo.
- A outra TV denominada `Academia Life` permanece sem heartbeat recente.
- O Supabase oficial da Vision Mídia **não tem as tabelas nem RPCs de campanha comercial** instaladas. O gateway implantado em produção não contém intercalamento comercial.
- A branch de homologação está **383 commits e 253 arquivos** diferente da produção. Não promover a branch inteira para produção.
- A homologação isolada da TV virtual, leitura assinada de mídia no Storage, cadastro de anunciante, contagem e limpeza foi aprovada previamente e não deve ser repetida.
- `player.js` lê itens padrão do manifesto por `item.media.id/type/url/checksum`. `augmentCommercial` produz essa estrutura, mas um ensaio físico ainda é necessário antes de considerar compatibilidade real.
- Ainda não há suporte operacional verificado à rotação por ciclos comerciais no Player real; o código indica que players reais não fornecem `cycle index`. Não anunciar garantia de frequência equitativa sem esse desenvolvimento/teste.

## Proteção nova, apenas código não publicado

`commercialPilotDeviceAllowed(device.id, VISION_COMMERCIAL_ENABLED, VISION_COMMERCIAL_PILOT_DEVICE_IDS)` faz a nova trava do gateway candidato. **Falha fechado** se flag geral não for exatamente `true`, se a lista explícita não contiver UUIDs válidos ou se o aparelho não constar dela. Limite de 5 IDs e rejeição de entradas malformadas. A mesma decisão protege augmentação de manifesto, identificação dos eventos e agregação diária. **Nenhum ID de TV real foi incluído ou configurado**. Não definir variáveis nem publicar no ambiente oficial sem autorização.

## Única prova física segura possível ANTES de alterar produção

Com responsável da Life presente e janela acordada de 5–10 minutos, realizar demonstração **local** da grade fictícia num navegador separado da TV Box, utilizando a página existente da homologação:
`https://vision-midia-digital-4teuw9qul-vision-5529.vercel.app/commercial-tv-media-player.html`

1. Fotografar/registrar a grade atual de 6 itens e obter consentimento explícito para pausar brevemente a exibição na tela do estabelecimento.
2. Abrir a página isolada no Chrome da própria TV Box. Não alterar/atualizar APK, playlist, token, credenciais nem banco. O laboratório usa arquivos locais, não sincroniza campanhas.
3. Confirmar 3 peças fictícias do estabelecimento, 1 anúncio fictício, continuidade/loop e comportamento de reconexão, sem tela branca/travamento. **Não confundir isso com prova de distribuição remota comercial.**
4. Fechar o Chrome e retornar ao Player oficial. Verificar ao vivo a grade original de 6 itens, áudio/orientação e heartbeat. Registrar início/fim, foto e resultado.
5. Se não conseguir retornar à programação, interromper a demonstração e restaurar o Player oficial sem instalar versões, limpar cache ou redefinir pareamento. Abrir incidente técnico específico; não seguir para produção.

## Critérios de autorização do piloto COMERCIAL real (fase posterior, separada)

- Comparar e aprovar individualmente SQL/RLS/Storage, Edge do gateway e compatibilidade Player, sem promover 253 arquivos de uma vez.
- Tornar habilitação restrita a UMA TV validada por allowlist explícita (feature flag desligada por padrão); não afetar outras TVs, nem alterar playlists.
- Capturar baseline, projetar janela e rollback: desligar flag e confirmar retorno da grade original, com observação real e logs.
- Confirmação explícita do usuário para produção e para breve janela de interrupção física, além de responsável no local.
- Validar anúncios com mídia autorizada e monitoramento de exibição; não misturar telemetria fictícia com dados de produção.

**GO / NO-GO agora:** habilitação remota de anúncios na Life fundo = **NO-GO**. Demonstração física local em janela autorizada = **PENDENTE DE AUTORIZAÇÃO**. Registro deste documento não altera produção, TV ou playlists.
