# Checkpoint — painel visual isolado da distribuição comercial

**Branch:** `fix/advertiser-portal-safety-20261013`
**Base preservada:** `c991b8c687eb049c2cd3221b89c2aa007802b6a7`
**Natureza:** interface estática de laboratório, apenas com fixtures e contadores na memória do navegador, sem deploy.

## Entrega

- `commercial-tv-fair-rotation-lab.html`: página responsiva em português do Brasil, identificada como **SIMULAÇÃO OFFLINE** e com aviso explícito de que contagens não representam publicidade real.
- `commercial-tv-fair-rotation-ui.mjs`: adaptador de interface conectado **apenas** às funções puras `createFairRotationLab`, `fairRotationView` e `fairRotationEvent` de `commercial-tv-fair-rotation-lab.mjs`. Não importa player, gateway, banco, telemetria ou sistema dos clientes.
- Conjunto fixo de 5 anunciantes e 6 mídias fictícias de Auto Center. Controles para tamanho da playlist (0, 1, 3, 6), ativação individual de anunciantes, iniciar, pausar, concluir item, completar 1 ou 5 rodadas fictícias, simular desconexão/reconexão/reinício, falha de mídia, revalidação comercial e zerar o ensaio.
- Contadores de itens base concluídos, anúncios fictícios concluídos e falhas; ordem da rodada, item atual, anúncios selecionados, lista de espera e situação de cada anunciante.
- Desativação ou alteração de inventário durante o ciclo retira imediatamente inserções comerciais restantes da programação fictícia. Apenas a playlist base continua na rodada atual, e o novo conjunto de comerciais só entra no próximo ciclo. Erro em anúncio bloqueia comerciais e exige revalidação explícita de fixtures.
- Botões só executam mudanças na memória do navegador. Não há vídeo real, intervalos de tempo, permissões, identificação de TV, sessão, upload nem requisição de rede. CSP declara `connect-src 'none'` e não carrega recursos externos.
- A página está **somente no GitHub da branch de testes**, não publicada em URL de produção. O arquivo HTML de laboratório depende do ES module da mesma branch e, portanto, precisa de um servidor estático local/isolado para uso no navegador; não anunciar que já está acessível como site publicado.

## Validação

Novos testes: `tests/commercial-tv-fair-rotation-ui.test.cjs` — 7 cenários cobrindo:
1. Estado inicial com cinco anunciantes, duas vagas e seis mídias base preservadas.
2. Simulação de dez rodadas com distribuição equilibrada (quatro conclusões fictícias para cada anunciante).
3. Contagens inválidas e TV sem playlist não avançam.
4. Desativação fictícia cancela callbacks/anúncios antigos e retoma apenas a programação base até o próximo ciclo.
5. Queda/reconexão/reinício fictícios não inflacionam contagens.
6. Todos os botões do HTML possuem callbacks declarados e avisos acessíveis.
7. Nenhum script de produção, comunicação externa ou credencial no HTML/JS.

Na primeira execução, duas verificações estáticas apontaram divergências de nomes de controles e a presença de uma palavra proibida apenas no comentário da UI. Houve patch mínimo em `commercial-tv-fair-rotation-ui.mjs` (nome correto do controle, comentário, fila sem playlist e revalidação explícita do inventário fictício); nenhuma alteração no modelo de distribuição ou no player.

**CI final: 244/244 PASS, 0 FAIL**, proteção de arquivos operacionais PASS:
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38641864836

## Limites e continuidade

Os testes do Node validam o modelo e as ligações estáticas da interface. **Ainda não há um teste visual executado em Chromium/Android para esta página**, nem evidência de comportamento real do dispositivo Smart Pro 3000. A distribuição justa também ainda não foi integrada ao gateway operacional: a versão atual continua a usar a seleção inicial sem índice da rodada.

**Próxima etapa segura:** homologar a página em navegador isolado (desktop e celular) verificando controles, renderização e proteções, e depois projetar o contrato de rodadas para integração futura; a produção permanece bloqueada até autorização explícita.

**Guardrails permanentes:** não alterar `player.js`, APK de clientes, playlists, Supabase/Edge Functions remotos, manifesto do gateway produtivo ou credenciais; não realizar deploy em produção.
