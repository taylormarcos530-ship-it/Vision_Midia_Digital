# Rede Vision — decisão técnica sobre entrega de prévias comerciais

**Checkpoint de origem:** `276b596ed9862557e0c9ca8b90861198389c279d`  
**Branch:** `fix/advertiser-portal-safety-20261013`  
**Escopo EXCLUSIVO:** prévias de imagens e vídeos no **portal do anunciante**, nunca a reprodução na TV nem a playlist do estabelecimento. **Não há deploy, migração, Edge Function, mudança no Storage/Supabase real, APK, player ou gateway.**

## Objetivo

Comparar, sem escolher prematuramente um backend, duas políticas para um **bucket privado** com **cópias comerciais independentes** das mídias originais do estabelecimento:

- **A — URL assinada de curta duração:** anunciante autenticado recebe uma URL assinada para a própria cópia comercial após autorização; o elemento `img`/`video` lê o objeto diretamente via Storage/CDN durante o prazo do link.
- **B — entrega com autorização em cada requisição:** navegador busca a cópia comercial por endpoint autenticado, que verifica anunciante, acesso, objeto e eventuais pedidos HTTP `Range` a cada `GET`/`HEAD`. Não há endpoint operacional desta espécie no projeto; existe **somente um servidor fictício em testes**.

**Conclusão provisória: A é a candidata mais simples apenas se a Vision aceitar expressamente o risco residual de URLs já emitidas e de conteúdo em cache.** Se o requisito do negócio for barrar imediatamente **novos pedidos HTTP de mídia** após a revogação, avaliar B, mas antes é obrigatório resolver autenticação de `<video>` nativo, WebViews legados, escala e custos. **Nenhuma das opções é aprovada para ativação.**

## Matriz de decisão

| Critério | A — URL assinada curta | B — endpoint autenticado por GET/Range |
| --- | --- | --- |
| Controle antes da entrega | RLS/ACL na emissão da assinatura. | Permissão verificada em cada requisição de leitura. |
| Bloqueio de novos acessos | Recusa novas assinaturas; links já emitidos podem continuar válidos. | Recusa novas leituras com 403, desde que o servidor realmente confira a sessão/estado. |
| Revogar bytes já baixados | Impossível garantir. | Também impossível garantir; vídeo previamente bufferizado pode continuar. |
| CDN/cache | CDN de Storage pode ajudar; token individual e `cacheControl` afetam hits e validade residual. | `private, no-store` reduz cache; caso se permita cache, deve ser compatível com identidade e revogação. |
| Requisições | Emissão de link mais GETs e Ranges diretamente ao Storage/CDN. | GET/HEAD/Range passam pelo endpoint, com autenticação, logs e limites em cada solicitação. |
| Tráfego | Storage/CDN -> navegador. | Storage/CDN -> proxy -> navegador: mais um trecho de rede, com cobrança que depende dos provedores. |
| Latência/desempenho | Menos saltos e melhor aproveitamento potencial do CDN. | Salto de proxy e validação adicional; pode ser reduzido por edge/streaming adequado, mas sem medida ainda. |
| Compatibilidade `img`/`video` | URL comum no `src`; caminho de menor atrito para mobile/Chromium/WebView. | Elemento `video` nativo não injeta Bearer arbitrário sozinho. Exige desenho de sessão/cookie com controles de CSRF/SameSite/CORS, ou outro transporte/Player homologado. |
| Suporte vídeo Range | Delegado ao Storage com URL assinada. | Proxy precisa lidar corretamente com 206, 416, Content-Range, Content-Length, cancelamento, buffering e desconexão. |
| Operação e observabilidade | Simplicidade relativa, menos infraestrutura própria; URLs com token exigem proteção de logs e referrer. | Mais superfície de segurança, escala, observabilidade e manutenção; pode isolar melhor o controle de acesso. |
| Risco de indisponibilidade | Dependência de Storage/CDN e emissão da assinatura. | Dependência simultânea de endpoint, autenticação e Storage; falha do proxy pode bloquear prévias. |
| Proteção das mídias do estabelecimento | **Obrigatória nos dois casos:** cópias comerciais próprias, bucket privado, RLS adequada e colunas de origem redigidas. | **Mesma exigência;** proxy não conserta SQL/RLS de origem indevido. |

## Resultados experimentais já verificados

- **Assinatura e cache:** URL já assinada permaneceu acessível dentro do TTL fictício após bloquear a conta; nova assinatura 403; nova leitura de proxy fictício 403; cópia previamente guardada no CacheStorage continuou disponível. **28 verificações Chromium.**  
  https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38668883697
- **HTTP Range com MP4 verdadeiro:** primeira requisição 206, seguinte 403 após bloqueio; outro anunciante manteve 206 para a própria cópia; painel permaneceu funcional. **39 verificações Chromium**, MP4 H.264/320×180. O MP4 foi reproduzido antes da revogação; não se demonstrou parada instantânea no meio do playback.  
  https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38669765524
- **Portal/Chromium:** prévia, falha 404, arquivo corrompido, troca de mídia, logout/403 e navegação mobile/desktop já têm homologação sintética independente. Não atestam Android WebView físico.
- **Modelo de tráfego, custo e gates:** `tests/commercial-delivery-options.test.cjs`, mais **17 cenários unitários** em Node: rejeição de parâmetros inválidos, tamanhos, ranges, hits hipotéticos de CDN, duas pernas de transporte, taxas explicitamente informadas, expiração/revogação, impossibilidade de retirar bytes já recebidos e critérios de aceite para cada política.

## Exemplo quantitativo reproduzível — NÃO SÃO NÚMEROS DA VISION

Hipóteses **fictícias**, para comparar esforços de entrega: 10 mil aberturas de prévia num período, tamanho médio de **6 MB efetivamente transferidos** por abertura e média de **4 GETs/Ranges** por mídia; A alcançaria hipoteticamente **20% dos bytes em cache** de CDN (não medidos). Aritmética em unidades decimais (1 GB = 1 bilhão de bytes).

| Grandeza | A — URL assinada | B — Proxy por requisição |
| --- | ---: | ---: |
| Bytes de mídia recebidos pelo navegador | 60 GB | 60 GB |
| Chamadas para emitir assinatura | 10.000 | 0 |
| GETs/Ranges de mídia | 40.000 no Storage/CDN | 40.000 no proxy |
| Verificações pelo proxy a cada leitura | — | 40.000 |
| Bytes na origem do Storage, na hipótese de cache acima | 48 GB | 60 GB se não houver cache a montante |
| Bytes entregues pelo CDN/cache na hipótese acima | 12 GB | Dependem do cache no acesso proxy->Storage |
| Bytes da perna proxy->navegador | — | **60 GB adicionais** |
| Total de bytes das duas pernas, **sem cobrar duas vezes automaticamente** | 60 GB em um trajeto de entrega | Até 120 GB de tráfego somando origem->proxy e proxy->navegador |

O cálculo é **modelo de fluxos**, não previsão de fatura. Requisições parciais variam com codec, seek, cache e dispositivo; downloads repetidos, cancelamentos e cabeçalhos podem alterar o volume real. O exemplo **não considera quotas incluídas**, impostos, conversão cambial, custo de compute, operações de Edge, saída de rede entre provedores nem desconto por cache. Preços somente podem ser inseridos explicitamente no modelo; o teste impede preços padrão inventados e sinaliza que qualquer USD é **taxa hipotética fornecida ao cálculo**.

**Por que a variável cache importa:** o Smart CDN da Supabase considera cada token de URL assinada como chave própria de cache; emitir sempre uma URL nova diminui o reaproveitamento do mesmo link. Expiração da assinatura e duração de cache são controles independentes. A separação de egress cached/uncached também afeta custos conforme plano, franquia e tabela atual.

Referências oficiais:
- URLs privadas, assinatura e chave separada de Auth: https://supabase.com/docs/guides/storage/serving/downloads
- Smart CDN, tokens distintos e expiração versus cache: https://supabase.com/docs/guides/storage/cdn/smart-cdn
- Separação de cached/uncached egress e descontos anunciados: https://supabase.com/changelog/38119-3x-cheaper-egress-for-cache-hits
- Painéis oficiais de uso/cobrança a consultar antes de estimar fatura: https://supabase.com/docs/guides/platform/manage-your-usage

## Gatilhos de decisão

**Escolher A somente se:** as peças comerciais forem publicáveis ao anunciante (e não o arquivo original do estabelecimento), a Vision aceitar uma janela residual de exposição inclusive cache após revogação, a política de storage privada/RLS e o SQL projetado estiverem homologados e o consumo real do CDN/egress for aceitável. O frontend experimental já solicita `expiresIn:60`, mas isso **não é garantia de revogação imediata**.

**Escolher B somente se:** revogação imediata de **novas leituras** for requisito indispensável e documentado; houver mecanismo de identidade confiável em `img`/`video` e suporte a Range em Android/WebView, proteção de cookie/cabeçalhos contra vazamento, limites e proteção de abuso, registros sem tokens, `Cache-Control` adequado, e capacidade de pagar por tráfego adicional, compute e manutenção. Nenhum proxy foi implantado.

**Se o requisito de revogação ainda não foi definido: não escolher implementação de backend agora.** Primeiro aprovar critério de negócio e medir tráfego em staging segregado. O portal pode continuar sendo desenvolvido na branch isolada sem tocar o cliente.

## Bloqueios gerais que continuam abertos

1. `supabase/sql/advertiser-portal.sql` continua **sem a correção de projeção/GRANT por coluna fora da fixture**; `source_media_id` e `source_storage_path` são campos internos que o anunciante não pode receber. O patch testado existe só em `tests/fixtures/commercial-safe-projection-lab.sql`.
2. Identidades de Master/anunciante/estabelecimento, RLS, Storage real, isolamento entre empresas, URLs reais, CDN, termos da conta e custos precisam de homologação em projeto **separado, após autorização explícita**.
3. WebViews antigos e TV Box física não foram usados. A decisão **sobre prévia no portal** não autoriza modificar o **player da TV**, que deve continuar respeitando autorização, `Aguardando playlist`, a playlist-base do estabelecimento, rotação, áudio e programação existente.
4. Não há autorização para migration, publicação Edge, configuração de bucket, deploy Netlify/Vercel, atualização APK nem qualquer alteração em dispositivo de cliente.

## Próxima etapa segura

Construir um **checklist de homologação de compatibilidade e custos observáveis**, com eventos instrumentáveis **somente no Chromium/servidor local**: contagem de GETs/Ranges, byte range, tempo de resposta fictício, taxa de cache, taxa de erros 403/416 e rejeição após revogação. Usar o checklist para decisão sem dados de produção e sem assumir que os números de laboratório representam desempenho do Supabase. A escolha final de A/B depende dos gates acima.

**Regra permanente:** preservar o estado funcional dos clientes; aplicar apenas patches mínimos isolados, sem restauração de baseline antigo e sem promoções a produção sem permissão específica.
