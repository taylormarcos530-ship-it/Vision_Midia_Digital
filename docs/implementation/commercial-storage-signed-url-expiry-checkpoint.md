# Vision Mídia Digital — checkpoint de validade e revogação de URLs comerciais assinadas

**Checkpoint anterior:** `f6b00ce2d7be72c0d226a7105c3649255a2d1e10`  
**Branch isolada:** `fix/advertiser-portal-safety-20261013`  
**Escopo:** auditoria e fixtures JavaScript isoladas, sem chamadas ao Supabase real, sem migration, sem Edge Function, sem deploy e sem alteração no APK, TV ou player.

## Conclusão de segurança

**Bloquear o anunciante impede novas assinaturas autorizadas, mas não revoga automaticamente uma URL comercial já assinada.** Uma URL assinada é uma credencial temporária associada ao objeto. A remoção de um elemento HTML do painel, logout e rotação do JWT da conta **não** revogam criptograficamente o link antigo.

A documentação oficial Supabase esclarece que as assinaturas de Storage são independentes das chaves JWT do Supabase Auth. Links emitidos permanecem válidos até sua expiração, mesmo após rotação da chave de Auth; para revogação específica das assinaturas, a documentação orienta contatar o suporte:

https://supabase.com/docs/guides/storage/serving/downloads

Uma segunda ressalva é **cache de CDN**. O tempo de expiração do token e o cache HTTP de um objeto são conceitos distintos; uma resposta do cache pode sobreviver ao vencimento da assinatura. A documentação sobre Smart CDN alerta que expirar um token não limpa a entrada de cache, e que a remoção de um objeto também pode demorar para se propagar:

https://supabase.com/docs/guides/storage/cdn/smart-cdn

**A solicitação de `expiresIn:60` do frontend limita a validade pretendida do token, mas não é uma garantia universal de interrupção física do acesso exatamente no segundo 60.** O comportamento real exige verificar configuração do bucket, cabeçalhos de cache, CDN e origem em um staging autorizado.

## Evidência de testes

- Arquivo criado: `tests/commercial-storage-signed-url-expiry-lab.test.cjs`.
- **14 testes de laboratório offline PASS**, incluindo a não revogação automática do bearer emitido, limitação de TTL na *política de exemplo*, contas e objetos separados, URL alterada, cache depois da expiração, simulação de gateway com autorização repetida e requisições de vídeo com `Range`.
- Suíte completa: **375/375 PASS, 0 FAIL**; guardião de arquivos operacionais **PASS**: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38668168006
- O verificador também confirma que `commercial-ui.mjs` ainda solicita **60 segundos** no `loadThumbnails` e que o SQL operacional não importa a fixture.

**Importante:** a fixture emprega tokens HMAC artificiais e cache simplificado, deliberadamente distintos dos algoritmos de Supabase. Ela **demonstra propriedades de segurança e limites de desenho**, mas não comprova as respostas de um Supabase real. Nenhuma URL funcional real foi criada.

## Matriz de riscos e controles previstos

| Situação | Resultado comprovado no modelo | Controle e pendência real |
|---|---|---|
| Anunciante A ativo solicita cópia comercial própria | Emitido token sintético | Storage RLS por anunciante, bucket privado, copiar peça comercial independente da mídia do ponto |
| A tenta assinar mídia privada do estabelecimento ou peça de B | Pedido rejeitado | Testar permissões e objetos reais em staging autorizado |
| A tem acesso bloqueado após emitir um link | Novas emissões recusadas; link anterior permanece válido até expirar no modelo sem cache | Nunca afirmar que logout revoga token já emitido |
| A expiração chega e não há CDN | Origem de laboratório recusa acesso | Confirmar tempo de relógio e headers no backend real |
| Uma URL foi cacheada com prazo maior | Modelo serve resposta em cache mesmo após vencimento | Revisar `cacheControl`, CDN e política de entrega; *não presumir revogação no segundo 60* |
| Token de link é alterado / objeto trocado no pathname | Recusado pela assinatura fictícia | URL só deve representar um snapshot comercial autorizado |
| Download por gateway que revalida sessão em cada request | Revogação passa a negar novas leituras | Requer arquitetura server-side separada, revisão de custo, tráfego, streaming e `Range` |
| Revogação após iniciar reprodução no navegador | Pode haver bytes já recebidos ou cacheados | Não prometer retirada retroativa de mídia distribuída ou capturada |

## Opções de política — NÃO IMPLEMENTAR SEM APROVAÇÃO

**Alternativa A — tolerância explícita a janela curta.** Para conteúdo publicitário não sensível, manter bucket privado, objetos comerciais separados, RLS estrita na emissão e assinaturas curtas (frontend solicita 60s). Revogação interrompe apenas **emissão de novas URLs**. O risco residual é a validade da URL já entregue e possível resposta de CDN em cache. Deve ser comunicado e aprovado; não serve para requisito de revogação imediata.

**Alternativa B — autorização renovada a cada solicitação.** Para eventual necessidade de bloqueio efetivo de **novas transferências** assim que a conta for revogada, considerar um gateway próprio autenticado que revalida anunciante, mídia comercial, campanha e estado da sessão a cada GET, inclusive requests HTTP Range. Respostas devem observar estratégia apropriada de `Cache-Control: private, no-store` e `Referrer-Policy`. Custos, cache, latência, desempenho de vídeo e tratamento de downloads já iniciados precisam de avaliação independente. **Nenhum gateway foi desenvolvido ou publicado nesta rodada.**

**Alternativa C — remoção de cópia comercial isolada.** A documentação de CDN menciona invalidação de conteúdo quando o objeto é apagado, com atraso potencial. Isso **não** deve ser tratado como um rollback seguro sem critérios de auditoria, cadeia de referências e backups. **Jamais deletar a mídia original do estabelecimento nem arquivos em uso nas playlists** para revogar um anúncio. A remoção real, se algum dia aprovada, deve usar a API oficial de Storage; nunca editar `storage.objects` diretamente.

Referência Storage (somente leitura e boas práticas de metadados):  
https://supabase.com/docs/guides/storage/schema/design

## Critérios para staging futuro, após autorização explícita

1. Criar ambiente segregado com anunciantes A/B, usuário do estabelecimento, bucket **privado** e cópias comerciais fictícias.
2. Revisar e homologar antes a correção de `source_media_id`/`source_storage_path` no SQL revisável; ela continua **somente em fixture local**.
3. Autenticar A, assinar apenas cópia própria, conferir valor de `expiresIn`, autorização cruzada e URLs externas; não expor tokens em logs ou capturas.
4. Bloquear A e verificar separadamente: novas assinaturas proibidas; comportamento de link já emitido observado até depois do TTL; respostas com e sem CDN; cabeçalhos e cache em vídeo MP4 com Range.
5. Simular logout, rotação de JWT, alteração de campanha e expiração do link sem afetar nenhuma mídia ou playlist base.
6. Determinar com o negócio se uma **janela residual** é aceitável ou se a entrega precisa ser autenticada a cada requisição. Registrar trade-offs antes de qualquer implementação.
7. Guardar relatório com horários do servidor e status HTTP, ocultando tokens e informações de clientes. Não usar contas, objetos ou TVs de produção.

## Preservação e próximo passo seguro

Nenhum arquivo operacional, SQL real, projeto remoto ou serviço de mídia foi alterado. **O portal real ainda não pode ser considerado seguro para ativação**, porque a projeção de colunas da origem do estabelecimento permanece pendente no SQL revisável fora do laboratório.

**Próxima etapa:** exercitar em Chromium local um proxy/Storage sintético que mantenha uma URL válida enquanto o painel encerra a sessão, e comparar uma resposta de cache com uma nova solicitação autenticada e negada; adicionar validações de não vazamento de URLs assinadas nos logs de frontend. Continuar em branch isolada, sem publicação ou alterações em TV Box.
