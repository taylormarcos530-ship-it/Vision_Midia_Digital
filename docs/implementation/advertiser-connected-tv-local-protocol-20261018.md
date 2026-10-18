# Vision Mídia Digital — teste da entrega para TV simulada (somente localhost)

## Objetivo
Complementar o checkpoint anterior `62d2baa`, sem conectar TV real nem criar métricas artificiais nos clientes. Este teste comprova um protocolo local HTTP do recebimento da programação, validação de URLs de mídia, enfileiramento offline, sincronização/repetição idempotente e separação dos relatórios.

## Escopo do ensaio
- `tests/commercial-connected-tv-local-protocol.test.cjs` importa diretamente `augmentCommercial`, `decorateCommercialRows`, `refreshCommercialDaily` e `interleave` reais de `supabase/functions/_shared/commercial.mjs`.
- Servidor HTTP aberto **somente em 127.0.0.1**; mídias são PNGs fictícios em memória e as credenciais são strings locais, nunca contas/tokens Supabase.
- TV fictícia com playlist de seis mídias recebe anúncios nas posições 4 e 8; download das mídias por URL local assinada.
- Com a conexão virtual suspensa, registra conclusões numa fila local; após a reconexão envia quatro eventos e reenvia o lote. O relatório contabiliza exatamente dois eventos válidos, uma vez cada.
- O segundo anunciante não recebe dados do primeiro.
- Autenticação inválida, mídia sem assinatura, comercial desligado e falha de assinatura preservam comportamento seguro.
- Playlists aleatórias e modo único preservados.

## Limites
Este teste **não** publica Edge Functions, ativa `device-gateway` no Supabase, usa um TV Box de verdade, verifica reprodução física ou grava provas de exibição externas. Os testes SQL, Storage real e portal de anunciante já aprovados permanecem separados. **Não declarar a distribuição comercial em produção pronta** até testar um dispositivo de bancada autenticado contra staging e obter autorização específica para o piloto Life fundo.

## Proteções
- Nenhum deploy, merge, mudança em playlist, cliente, produção, Supabase ou APK.
- `npm test` inclui automaticamente a nova suíte.
- Todos os dados do ensaio morrem ao encerrar o processo Node e a porta local.
