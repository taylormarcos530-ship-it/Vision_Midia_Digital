# Checkpoint — distribuição equilibrada offline de anúncios comerciais

**Base preservada:** `5a561f73930a4dc24e811e9458973a084f5c8023`.
**Branch:** `fix/advertiser-portal-safety-20261013`.
**Escopo:** biblioteca isolada de laboratório + testes Node; nenhum player/APK/gateway, playlist, Supabase remoto ou Edge Function alterado.

## Entrega

- Nova biblioteca `commercial-tv-fair-rotation-lab.mjs`, não importada pelo gateway real.
- Reutiliza o helper puro existente `interleave` e a regra `commercialEligibility`, sem alterar ambos.
- Em cada rodada fictícia, seleciona anunciantes pelo menor número de **reproduções comerciais concluídas**. Um cursor estável desempata e evita favorecer sempre o primeiro anunciante quando há mais anúncios que vagas.
- Seis mídias do ponto permitem duas inserções intercaladas. A seleção nunca remove, reordena ou substitui as mídias do estabelecimento.
- O índice só avança mediante um evento de conclusão válido, marcado com token da geração/rodada/posição. Callbacks duplicados ou atrasados são descartados. Iniciar ou preparar mídia não registra exibição.
- Queda, reconexão, pausa e reinício **simulados** exigem nova geração e retomada explícita; não contabilizam impressão de anúncio.
- Mudança de inventário de anunciantes cancela imediatamente inserções comerciais antigas no ciclo corrente, preserva a posição relativa das mídias do estabelecimento e passa a usar o novo conjunto somente no ciclo seguinte. IDs ausentes/duplicados/inválidos impedem anúncios.
- Erro de codec em mídia comercial: interrompe, bloqueia inserções e preserva os itens do estabelecimento; reativação do laboratório exige reposição/revalidação explícita, sem afirmar conclusão do anúncio falho.
- Playlist ausente, shuffle, modo single e mídias-base com agendamento individual nunca recebem anúncios, conforme regras já existentes.
- Sem rede, banco, autenticação, timers, persistência ou contagem comercial em produção. Estado de bancada apenas em memória.

## Testes

Arquivo novo: `tests/commercial-tv-fair-rotation-lab.test.cjs` (10 cenários).
Foram exercitados: 5 anunciantes/2 vagas ao longo de 10 ciclos (4 conclusões por anunciante); playlist curta; conclusão duplicada; queda/reconexão/reinício; retirada ou inclusão de anunciante durante mídia; falha de codec sem contagem falsa; revalidação explícita; inventário inválido; playlists protegidas; ausência de imports operacionais.

Houve uma falha inicial em **dois testes** porque o helper de teste tentava acionar Iniciar novamente após a passagem automática à rodada seguinte; isso contrariava o estado correto `running=true`. Ajustado **somente o helper de teste**, sem alterar a biblioteca ou comportamento esperado de reprodução.

**CI final PASS:** https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38640260731

## Limite de homologação e próxima etapa

Esta distribuição justa é **somente modelo offline**. O `augmentCommercial` do gateway real ainda usa `interleave(primary,ads)` sem índice de rodada e **não oferece a mesma distribuição equilibrada automaticamente**. Não marcar essa lacuna como corrigida no player de clientes. A integração futura exige desenho específico de como a rodada/posição/identidade de campanha são conhecidas pelo servidor, compatível com versões antigas do player e sem alterar playlists.

**Próximo bloco seguro:** criar uma visualização interativa exclusivamente no laboratório para inspecionar a distribuição por anunciante/ciclo, a fila pendente e o fallback quando campanhas são desativadas. Usar fixtures fictícias, sem credenciais, conexão ou deploy. Antes de integrar com infraestrutura real: homologar o contrato de sincronização, reset da rodada e persistência de identidade/revisões; exigir aprovação separada para qualquer mudança operacional.
