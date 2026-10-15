# Vision Mídia Digital — checkpoint de cache, bearer assinado e bloqueio de acesso

**Base preservada:** `a1e196e7df2a6317f5b926dfa0c92c5bb8de0eec`  
**Branch isolada:** `fix/advertiser-portal-safety-20261013`  
**Execução:** Chromium verdadeiro com HTTP local somente em `127.0.0.1`, objetos sintéticos, autenticação sintética e relógio lógico de laboratório. **Nenhum Supabase, bucket real, player, APK, playlist, TV de cliente, migration ou deploy foi utilizado.**

## Resultado aferido

**Novo teste Chromium: 28 verificações PASS, 0 falhas.**  
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38668883697

**Regressão de segurança: 375/375 testes PASS, 0 falhas, proteção dos arquivos operacionais PASS.**  
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38668883679

O teste adicionou somente dois artefatos executáveis na branch de laboratório:

- `tests/browser/commercial-signed-url-cache-browser.cjs`: servidor HTTP descartável, isolado no loopback, mais navegador Chromium. Importa a classe **real** `CommercialAPI` e a rotina `loadThumbnails` do frontend, com respostas fictícias. O servidor assina um identificador fictício de cópia comercial e verifica o token por mapa de memória. **Não replica criptografia, Storage RLS ou CDN do Supabase.**
- `.github/workflows/commercial-storage-signed-cache-browser.yml`: workflow independente do teste de MP4, acionado só por arquivos da bancada, com guarda de arquivos operacionais, Node 22, navegador Chromium pré-instalado e `playwright-core` temporário (sem mudanças no lockfile).

### Observações diretas no navegador

1. Antes do bloqueio, a imagem comercial de laboratório é carregada e o endpoint fictício devolve **200**.
2. Após o bloqueio do anunciante A, **uma nova assinatura** recebe **403**, inclusive para cópia pertencente a outro anunciante e para a mídia original do estabelecimento.
3. Uma **URL já assinada** antes do bloqueio ainda recebe **200** numa nova leitura da origem, até seu TTL fictício de 60 segundos terminar. Logout/revogação do anunciante não fazem a assinatura emitida desaparecer do servidor.
4. Uma rota fictícia de **proxy com verificação de sessão em toda requisição** nega um novo GET com **403** imediatamente após o bloqueio e envia `Cache-Control: private, no-store`.
5. Depois de avançar **somente o relógio lógico do servidor** por 61 segundos, uma nova requisição de origem com `cache: 'no-store'` é negada com **403**.
6. O corpo previamente armazenado via **CacheStorage explícito do Chromium** continua disponível com **200**, mesmo depois da expiração na origem. Isso comprova retenção de bytes **nesse mecanismo de cache local**, não prova a duração ou o comportamento do HTTP cache automático nem do CDN Supabase.
7. O teste também solicita leitura HTTP `force-cache` e registra que o navegador respondeu com um status definido (200 ou 403), mas deliberadamente **não atribui um resultado fixo ao HTTP cache**, pois esse comportamento pode variar conforme ambiente. A prova determinística de armazenamento em cache é o CacheStorage explícito.
8. Os logs coletados da aplicação fictícia e as mensagens de console do frontend não continham o bearer sintético. O audit registra tipo/status de evento sem query string, URL completa ou cabeçalho Authorization. Essa observação **não demonstra** ausência do token em logs internos de proxy, ferramentas do navegador, operadora ou CDN real.

O objeto de mídia é uma imagem SVG fictícia entregue em um caminho com extensão `.webp`. O teste valida o carregamento real da imagem no Chromium e o comportamento HTTP/cache; não é um teste de decodificação WebP. MP4 verdadeiro já foi exercitado separadamente na rodada anterior.

## Interpretação para o produto

**Proteção atual comprovada:** a UI pode retirar uma prévia de tela após logout ou revogação, e a autorização de novas assinaturas pode bloquear novas solicitações.

**Proteção não demonstrada:** revogação instantânea de um arquivo cujo endereço assinado já saiu do servidor e foi entregue ao navegador. Uma URL recebida pode permanecer utilizável até o vencimento previsto, e bytes já armazenados em cache não podem ser apagados remotamente de maneira garantida.

A documentação oficial do Supabase sobre URLs assinadas e CDN deve nortear uma futura política de produção:
- https://supabase.com/docs/guides/storage/serving/downloads
- https://supabase.com/docs/guides/storage/cdn/smart-cdn

A solicitação atual do frontend continua usando `expiresIn:60`, mas isso por si só **não estabelece revogação imediata**, exclusão da cópia comercial, desativação de CDN ou verificação de autorização por reprodução.

## Dependências antes de habilitar o portal real

Permanece pendente a correção de colunas sensíveis na versão revisável de `supabase/sql/advertiser-portal.sql`. A projeção com `GRANT SELECT` por coluna continua **apenas na fixture de laboratório** `tests/fixtures/commercial-safe-projection-lab.sql`. Nenhuma tabela/SQL remoto foi alterado.

Decidir com autorização explícita qual requisito do negócio se aplica: **janela curta de acesso residual aceita** (cópia comercial separada, assinaturas breves, RLS na emissão) ou **novas leituras autenticadas em todas as requisições** (proxy/streaming com custo e compatibilidade próprios). Em qualquer opção, bytes já transferidos, cache e capturas não podem ser revogados retroativamente. Não excluir mídia original, playlists ou histórico do estabelecimento.

## Próximo bloco seguro

Homologar **em Chromium e servidor local**, sem backend de produção, um fluxo simulado de vídeo com requisições `Range` onde a autorização é novamente verificada após revogação; conferir `206`, `403`, `Cache-Control` e comportamento do player diante de interrupção. Manter scripts e testes exclusivamente sob `tests/` e workflows de laboratório.

**Regras permanentes:** não promover a produção, não atualizar APK/TV Box, não modificar player, gateway, Edge Functions, SQL, playlists ou Storage de clientes sem autorização específica.
