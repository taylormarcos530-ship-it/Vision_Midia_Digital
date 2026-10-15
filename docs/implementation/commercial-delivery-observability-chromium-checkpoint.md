# Vision Mídia Digital — Checkpoint de telemetria local de prévias comerciais

**Checkpoint anterior:** `4848035474c45306bb1f3dfc4518cfd5d11d8635`  
**Branch de testes:** `fix/advertiser-portal-safety-20261013`  
**Ambiente de ensaio:** Chromium Linux headless, servidor `127.0.0.1`, MP4 H.264 **genuíno**, FFmpeg temporário no runner, sessão, assinatura e cache **inteiramente fictícios**. Nenhum pedido de rede ao Supabase, à produção, à Netlify ou às TVs de clientes.

## Resultado verificado

- **Novo experimento Chromium:** **46 verificações PASS**, sem falhas, executado na mesma bateria do portal.
- **Baterias anteriores Chromium:** 113 verificações de navegação/MP4 e 39 de `Range`/revogação, ambas PASS.
- **Execução real dos experimentos:** https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38673104694
- **Regressão geral:** **401/401 testes PASS, 0 falhas**, incluindo 9 testes novos do coletor de métricas; proteção de player, APK e APIs operacionais PASS.
- **Execução de regressão:** https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38673104651

## Escopo dos arquivos

- `tests/fixtures/commercial-delivery-metrics.cjs`: coletor tipado, com lista branca **somente** de estratégia (`signed`/`proxy`), tipo de requisição, HTTP status, bytes, flag Range, cache e tempo observado. **Não armazena** URL, token, JWT, cabeçalho, nome de anunciante ou caminho de objeto. Apuração agregada por estratégia com p50/p95.
- `tests/commercial-delivery-metrics.test.cjs`: 9 testes isolados de contagem, agregação, p50/p95, rejeição de entrada inválida, isolamento de relatórios e exclusão de campos sensíveis.
- `tests/browser/commercial-delivery-metrics-browser.cjs`: gera MP4 real em diretório temporário, executa `fetch` do Chromium com `Range` e mede resposta do **servidor local** com `performance.now()`. Os caminhos de assinatura/proxy são implementações **sintéticas** que não modificam o frontend operacional. O cache `HIT` é simulado explicitamente no servidor de laboratório; não equivale a Smart CDN nem ao cache automático do navegador.
- `.github/workflows/commercial-portal-sanitized-chromium.yml`: amplia a bateria Chromium existente para executar o ensaio e continua bloqueando alterações de arquivos operacionais.
- Este checkpoint documenta os números efetivamente obtidos na execução vinculada, sem converter em custo comercial.

## Medições observadas — apenas este runner

| Indicador | URL assinada fictícia | Proxy autenticado fictício |
| --- | ---: | ---: |
| Total de requisições contabilizadas | 8 | 6 |
| Emissões de assinatura | 2 (uma 200, uma 403) | 0 |
| GETs de mídia / Range | 6 / 6 | 6 / 6 |
| GETs de mídia bem-sucedidos (206) | 4 | 4 |
| Erros 403 (todos os tipos) | 2 | 1 |
| Erros 416 | 1 | 1 |
| Acertos de **cache simulado** | 1 | 0 |
| Bytes de MP4 entregues com sucesso | 3.072 B | 3.072 B |
| Bytes atribuídos à origem | 2.048 B | 3.072 B |
| Bytes de saída pelo proxy intermediário | 0 B | 3.072 B |
| Tempo de processamento **no servidor local**, p50 dos GETs | 2,453 ms | 7,762 ms |
| Tempo de processamento **no servidor local**, p95 dos GETs | 5,960 ms | 9,477 ms |
| Amostras de GET para p50/p95 | 6 | 6 |

**Não interpretar p50/p95 como comparação de velocidade da arquitetura:** o laboratório **introduziu atrasos artificiais diferentes** nos dois endpoints (assinatura, cache HIT/MISS e proxy) para verificar se a coleta distingue os casos. Não mede RTT da internet, time-to-first-frame, desempenho de autenticação Supabase real, CDN, custo ou SLA. O conjunto é muito pequeno (6 GETs por caminho), misturando sucesso e erro, e não permite intervalos de confiança significativos.

**Também não tomar os bytes totais como equivalência perfeita entre estratégias:** a sequência contém um teste **pós-revogação** em que um bearer ainda válido serviu ao anunciante A, mas o proxy negou A; no proxy houve uma transferência autorizada de B. Por isso os 3.072 B de cada caminho resultam de operações diferentes apesar de terem o mesmo total. Os bytes são contados por trecho simulado e não representam fatura, cache de fornecedor ou consumo histórico da Vision.

O servidor fictício não transporta credenciais reais. `X-Lab-Cache: HIT` representa apenas um `Map` em memória criado pelo teste. O relatório registra quantidades e status; a URL assinada sintética fica na memória do navegador e não aparece no JSON impresso, no console capturado nem nas estatísticas agregadas.

## Comportamento funcional e segurança

1. Antes do bloqueio, ambas as estratégias retornam `206` para partes válidas do MP4, `416` para faixa impossível.
2. A segunda solicitação do mesmo Range na URL assinada apresenta um `HIT` artificial e não incrementa bytes da origem; a solicitação equivalente ao proxy consulta a autorização e conta a saída do proxy novamente.
3. Após o bloqueio, **emitir novo link** retorna `403`; a URL **anterior ainda válida** aceita novo `Range` enquanto o TTL fictício não expira.
4. No proxy fictício, o `Range` de A após revogação é negado com `403`; a cópia própria de B permanece acessível.
5. Após avançar 61 segundos no relógio lógico da fixture, o link assinado deixa de funcionar na **origem** (`403`).
6. Zero exceções de navegador e zero acessos a hosts externos. A regressão e a guarda de arquivos oficiais permaneceram verdes.

## Decisão que este teste NÃO autoriza

**Nenhuma decisão de entrega em produção foi tomada.** A alternativa A (URL assinada breve) segue candidata se o negócio aceitar janela residual de acesso e CDN/cache; a B (leitura autenticada) precisa de implementação e testes reais da autenticação de `<video>`, `Range`, CORS/cookie/SameSite e custo operacional. Em ambos os casos, dados previamente recebidos ou armazenados em cache não podem ser revogados retroativamente.

Continua **aberto** o achado de exposição de `source_media_id` e `source_storage_path` no SQL revisável `supabase/sql/advertiser-portal.sql`. O patch de projeção/GRANT permanece apenas em `tests/fixtures/commercial-safe-projection-lab.sql`. Antes de qualquer integração real, é obrigatório corrigir e homologar o acesso no ambiente segregado autorizado.

A matriz anterior permanece a referência de trade-offs: `docs/implementation/commercial-preview-delivery-policy-comparison.md`.

## Próxima etapa segura

Construir teste **somente local** com variação controlada de tamanho de mídia, número de seeks/`Ranges` e proporções simuladas de cache, exportando uma tabela de sensibilidade com as mesmas métricas e limites explícitos. Não publicar endpoints, não acessar Storage de clientes e não inferir custos reais sem preços/uso efetivos. A recomendação final depende da tolerância explícita à janela residual de acesso e da homologação do dispositivo-alvo.

**Salvaguarda permanente:** player, APK, playlist-base do estabelecimento, gateway, Supabase, dados e deploy de produção intocados; nenhum merge, migration, Edge Function ou deploy autorizado neste checkpoint.
