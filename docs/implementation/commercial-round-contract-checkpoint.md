# Vision Mídia Digital — Contrato de identidade das rodadas comerciais (laboratório)

**Branch:** `fix/advertiser-portal-safety-20261013`.
**Base anterior intocada:** `d81701e25fff94ea20359b997f169aa3c7a4bd9d`.
**Execução:** somente arquivos novos de laboratório. Sem alteração de player/APK, manifestos, playlists ou funções Supabase; sem migrations/deploy.

## Escopo exato entregue

- `commercial-tv-round-contract-lab.mjs`: módulo puro **OFFLINE LAB ONLY**, não importado pelo gateway, pelo `player.js` nem pelo APK dos clientes.
- `tests/commercial-tv-round-contract-lab.test.cjs`: **13 casos** com playlists, TVs e anúncios fictícios.
- O descritor de programação usa identidade explícita da **TV**, revisão da atribuição, ID/revisão da playlist, ordem e IDs das mídias base, checksums, durações/agendamentos, revisão do inventário comercial, IDs/versões de todas as peças comerciais e declaração de capacidades do player.
- `describeRoundProgram` constrói chaves determinísticas de base/comercial e um motivo para bloquear inserção quando não houver playlist ou o dispositivo declarar suporte insuficiente para o contrato (protocolVersion 0, ausência de agenda por item, timezone não compatível). A identificação **não é hash de segurança nem credencial**.
- `currentRoundLease` identifica somente a ocorrência fictícia atual (programação + época + geração/rodada/posição/mídia). Eventos `complete`/`media-error` só são aceitos com lease da ocorrência atual; duplicados ou atrasados não contam.
- `exportRoundCheckpoint`/`restoreRoundCheckpoint`: passagem de estado **explícita e somente em memória confiável**. Para a mesma programação, recupera rodada e posição, mas **pausada**, incrementa a geração e rejeita callbacks anteriores.
- Se mídia comercial, agenda, lista de anunciantes ou capacidades mudarem, a recuperação entra no modo **somente playlist do ponto**; se a programação base se manteve idêntica, começa na próxima mídia base ainda não concluída no ciclo, sem avançar anúncio cancelado. Se a playlist/atribuição/TV mudar, reinicia em `posição 0` com comerciais bloqueados.
- Player legado/incompatível: nada comercial é inserido; conserva a mídia do estabelecimento. Identificadores inválidos/duplicados de comerciais bloqueiam comerciais e mantêm a playlist base válida; identificadores base inválidos impedem criar uma sequência semântica confiável.
- Não existe habilitação automática após falha. Alterações de inventário só são aceitas por uma nova descrição validada; eventos do player não podem acionar livremente `inventory-changed` ou `revalidate`.

## Testes confirmados

**GitHub Actions:** 257/257 testes PASS, 0 FAIL, guardião de arquivos operacionais PASS.
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38644019880

Verificações cobrem identificadores de programação, revisões das mídias e anúncios, identidades entre TVs, lease único, callbacks duplicados, reinício, checkpoint compatível/incompatível, remoção de anunciante, fallback apenas base, modo antigo e modo "Aguardando playlist". Uma primeira versão do novo teste encontrou entrada inválida na playlist de laboratório; o patch final recusou playlist base malformada e manteve playlist base válida quando apenas os comerciais estão inválidos. **Nenhuma parte do player operacional foi alterada.**

## Limites claros — NÃO usar como prova de produção

A identificação é construída por JSON determinístico, **não tem assinatura/autenticidade**. O checkpoint é um objeto fictício de memória local, não uma prova de eventos, nem uma estratégia segura de persistência offline. As contagens simuladas não são métricas comerciais. Ainda não existe relógio confiável/versão de programação publicada pelo servidor, chave de ocorrência emitida pelo player oficial, garantia de entrega/duplicidade multi-TV, manutenção de eventos após fechar o aplicativo, nem caminho homologado de reconciliação de relatórios reais.

O gateway operacional `augmentCommercial` ainda chama `interleave(primary,ads)` sem índice real de rodada. Portanto **não afirmar** distribuição equitativa entre anunciantes no player de clientes, nem liberar comerciais reais com base nestes testes.

## Próximo bloco seguro

Escrever um **contrato de integração em staging apenas como especificação e fixtures**, contemplando idempotência de `playback_logs`, servidor como autoridade para revisão e atribuição, compatibilidade dos players antigos, interrupção com cancelamento e expiração e auditoria de contadores sem estimativas. Não conectar staging/produção nem alterar o gateway/APK sem autorização separada e homologação em ambiente isolado.

**Regras permanentes:** não alterar `player.js`, `android-player/`, playlists, banco/Edge Functions de produção, nem publicar deploy; preservar integralmente o que funciona nos clientes.
