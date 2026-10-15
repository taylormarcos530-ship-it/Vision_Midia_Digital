# Rede Vision — checkpoint de sensibilidade de mídia, Range e cache

**Origem preservada:** `5c8ca1afa1b31e5a0cc9badf96704afbd3113183`  
**Branch de laboratório:** `fix/advertiser-portal-safety-20261013`  
**Escopo:** prévias de anúncios no portal do anunciante, **não** player da TV ou campanhas comerciais ativas. Nenhum banco, Storage, gateway, APK, device-gateway, playlist ou produção foi modificado.

## Evidências de homologação

- **Teste de modelo:** 27 cenários (3 tamanhos × 3 quantidades de Ranges × 3 frações esperadas de cache), com **10 testes de regressão novos**. Suíte completa **411/411 PASS**, 0 FAIL. Guardião dos arquivos operacionais PASS: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38674692610
- **Chromium real e MP4 H.264 verdadeiro:** 27 cenários independentes e **360 verificações PASS**, 0 falhas. A mesma execução manteve aprovadas as baterias anteriores de 113, 39 e 46 verificações; arquivo MP4 e dados foram gerados localmente, sem chamadas externas: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38674692435
- Foram alterados **exclusivamente** arquivos sob `tests/`, o workflow Chromium já isolado e este relatório. Nenhum deploy, Edge Function, migration ou mudança no aplicativo das TVs.

## Como o teste foi construído

1. `tests/fixtures/commercial-delivery-sensitivity.cjs` calcula demanda sintética com **1.000 prévias** por cenário, tamanhos hipotéticos de **1, 6 e 20 MB por prévia efetivamente transferidos**, entre **1, 4 e 12 GETs/Ranges por prévia**, e taxas **supostas de acerto em bytes** de 0%, 50% e 90%. Uma assinatura por prévia, sem re-download adicional por seek.
2. `tests/commercial-delivery-sensitivity.test.cjs` inclui 10 testes para os 27 cenários, limites e valores inválidos, independência de bytes e GETs, cobrança não inferida, cache e possibilidade explícita de re-download se houver seeks repetidos.
3. `tests/browser/commercial-delivery-sensitivity-browser.cjs` gera **três MP4 H.264 locais reais** com duração de 1, 3 e 6 segundos e tamanhos efetivos **75.502 B, 222.943 B e 457.298 B**. Em Chromium, cada arquivo é consultado por 1, 4 e 12 Ranges em duas rotas HTTP fictícias (assinatura e proxy). Antes de cada rodada, o servidor **pré-carrega artificialmente** parte dos segmentos na memória, simulando um cache hipotético. O navegador verifica conteúdo e status 206, e o servidor registra bytes de origem, bytes enviados, 403/416, acertos e tempo local. Foram **360 verificações** nesta execução.
4. O teste de revogação confirma **403** para novas requisições autenticadas e assinaturas; 416 é gerado para Range inválido. Nenhum token ou caminho sensível aparece no JSON das métricas.
5. A coleta usa `tests/fixtures/commercial-delivery-metrics.cjs`, que armazena apenas contadores, status, tamanho e latência, sem registrar JWT, cabeçalhos de autorização ou URL assinada.

**Atenção:** os arquivos de 75–457 KB medidos pelo Chromium **não são** os cenários hipotéticos de 1–20 MB. São duas fontes deliberadamente distintas: a matriz abaixo projeta demanda; o navegador valida o protocolo e a sensibilidade da instrumentação com vídeos locais menores.

## Matriz de demanda hipotética — 27 cenários

A tabela abaixo deriva de 1.000 aberturas de prévia e 1 GB decimal = 1.000.000.000 bytes. A estratégia **A** é entrega por URL assinada diretamente ao Storage/CDN, com o percentual **assumido**, não verificado, de hit em bytes. A estratégia **B** é o proxy com **0% de cache a montante** na hipótese calculada. Todos os arquivos são supostos inteiramente recebidos; em troca de posicionamento no vídeo, download parcial/cancelado e trechos repetidos, o tráfego real pode mudar.

| Tamanho hipotético por prévia | Ranges por prévia | Cache de bytes suposto | GETs (1.000 prévias) | Origem A (GB) | Origem B (GB) | Saída proxy (GB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MB | 1 | 0% | 1.000 | 1 | 1 | 1 |
| 1 MB | 1 | 50% | 1.000 | 0,5 | 1 | 1 |
| 1 MB | 1 | 90% | 1.000 | 0,1 | 1 | 1 |
| 1 MB | 4 | 0% | 4.000 | 1 | 1 | 1 |
| 1 MB | 4 | 50% | 4.000 | 0,5 | 1 | 1 |
| 1 MB | 4 | 90% | 4.000 | 0,1 | 1 | 1 |
| 1 MB | 12 | 0% | 12.000 | 1 | 1 | 1 |
| 1 MB | 12 | 50% | 12.000 | 0,5 | 1 | 1 |
| 1 MB | 12 | 90% | 12.000 | 0,1 | 1 | 1 |
| 6 MB | 1 | 0% | 1.000 | 6 | 6 | 6 |
| 6 MB | 1 | 50% | 1.000 | 3 | 6 | 6 |
| 6 MB | 1 | 90% | 1.000 | 0,6 | 6 | 6 |
| 6 MB | 4 | 0% | 4.000 | 6 | 6 | 6 |
| 6 MB | 4 | 50% | 4.000 | 3 | 6 | 6 |
| 6 MB | 4 | 90% | 4.000 | 0,6 | 6 | 6 |
| 6 MB | 12 | 0% | 12.000 | 6 | 6 | 6 |
| 6 MB | 12 | 50% | 12.000 | 3 | 6 | 6 |
| 6 MB | 12 | 90% | 12.000 | 0,6 | 6 | 6 |
| 20 MB | 1 | 0% | 1.000 | 20 | 20 | 20 |
| 20 MB | 1 | 50% | 1.000 | 10 | 20 | 20 |
| 20 MB | 1 | 90% | 1.000 | 2 | 20 | 20 |
| 20 MB | 4 | 0% | 4.000 | 20 | 20 | 20 |
| 20 MB | 4 | 50% | 4.000 | 10 | 20 | 20 |
| 20 MB | 4 | 90% | 4.000 | 2 | 20 | 20 |
| 20 MB | 12 | 0% | 12.000 | 20 | 20 | 20 |
| 20 MB | 12 | 50% | 12.000 | 10 | 20 | 20 |
| 20 MB | 12 | 90% | 12.000 | 2 | 20 | 20 |

**Interpretação:** com 1.000 prévias de 6 MB, o navegador recebe 6 GB em ambas as opções, independentemente de 1, 4 ou 12 requisições — **desde que** o total de bytes entregue por prévia continue sendo 6 MB. A passou de 6 GB na origem (sem cache) para 0,6 GB (90% de hit hipotético). B manteve 6 GB na perna Storage→proxy e mais 6 GB na perna proxy→navegador (na hipótese sem cache), sem que isso implique necessariamente cobrança dobrada. As verificações de autorização B sobem de 1.000 para 12.000 conforme o número de Ranges.

**O cache de URL assinada é particularmente incerto:** links assinados com tokens novos podem ter chaves de cache distintas no CDN. **Nenhum** percentual de hit da tabela é estimativa do Supabase ou resultado de medição real da Vision.

## Dados realmente observados na rodada Chromium

| Perfil do MP4 real | Bytes MP4 | Ranges | Cache-alvo artificial | Hit em bytes observado | Origem A | Origem B | Saída B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Curto (1 s) | 75.502 B | 4 | 50% | 50% | 37.751 B | 75.502 B | 75.502 B |
| Médio (3 s) | 222.943 B | 4 | 50% | 50% | 111.472 B | 222.943 B | 222.943 B |
| Longo (6 s) | 457.298 B | 4 | 50% | 50% | 228.649 B | 457.298 B | 457.298 B |
| Longo (6 s) | 457.298 B | 12 | 90% | **83,33%** | 76.217 B | 457.298 B | 457.298 B |

O desvio 90%→83,33% não indica falha de CDN: como a fixture aquece `floor(12×0,90)=10` segmentos completos dentre 12, o hit efetivo de bytes é aproximadamente 10/12. Com só 1 Range, a pré-carga de 50% ou 90% se arredonda para **zero segmentos**, impossibilitando atingir essas frações no ensaio. Em um CDN real, o acerto é determinado por chaves, validade, tamanho de segmentos, políticas de cache e padrões efetivos de navegação, não por esse mecanismo.

### Limitações das medições de latência

O navegador foi executado em loopback no GitHub Actions. A coleta de latência usa o intervalo local do início da requisição até o registro do servidor, antes do envio efetivo do corpo. Os valores p50/p95 **não medem** RTT de rede, tempo até primeiro frame, decode de vídeo, autorização de produção, CDN nem latência perceptível pelo usuário. Não classificar a estratégia A como mais rápida ou B como mais lenta com base nestes números. Nenhum preço Supabase, egress, operações HTTP, hardware, plano ou moeda foi obtido para essa comparação.

## Decisão provisória e bloqueios de segurança

**A (URL assinada curta)** continua candidata mais simples para prévia comercial **somente se** a Vision aceitar expressamente a janela residual de acesso após bloqueio da conta e o comportamento de cache. **B (proxy com autorização a cada GET/Range)** é candidata quando negar **novas transferências** imediatamente for indispensável; porém exigiria servidor seguro, autenticação compatível com `<video>` no WebView alvo, tratamento de cabeçalhos Range, capacidade de tráfego e análise de custos. Conteúdo já baixado não é revogável por nenhum dos métodos.

A correção dos campos internos `source_media_id`/`source_storage_path` de `supabase/sql/advertiser-portal.sql` **permanece exclusivamente na fixture de laboratório** `tests/fixtures/commercial-safe-projection-lab.sql`. Não habilitar portal de anunciante em produção sem corrigi-la e homologar autenticação/RLS/Storage em staging expressamente autorizado.

## Próxima etapa segura

Usar a matriz de 27 casos e os resultados Chromium para definir **critérios verificáveis de aceite de staging**: contas A/B, cópias comerciais privadas, RLS, TTL e cache realmente observados, segurança de tokens, compatibilidade de navegador e estimativa de egress baseada no plano contratado. Isso pode ser estruturado como checklist **sem acessar serviços reais**, mantendo o bloqueio absoluto a merges, deployments, migrations ou mudanças no player/TV sem nova autorização.

**Regra permanente:** preservar tudo que funciona; não restaurar baseline antigo, não remover funções operacionais e não tocar no player, APK, playlists, gateway, Supabase, deploy ou TVs de clientes.
