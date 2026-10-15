# Rede Vision — checklist de homologação do Portal Comercial em staging

**Checkpoint de origem:** `f44dba31fa72b6feca60eff0fd7f8b638eb61487`  
**Branch experimental:** `fix/advertiser-portal-safety-20261013`  
**Status geral:** **BLOQUEADO / NÃO HOMOLOGADO**. Este é um plano verificável para uma execução **futura** em ambiente segregado, **não** um teste remoto realizado, uma autorização para usar Supabase ou uma solicitação de deployment.

## O que foi preparado, sem tocar nos clientes

- **Contrato de aceitação** `tests/fixtures/commercial-staging-readiness.cjs`: 17 requisitos, resultado fail-closed, inventário de evidências por requisito e critérios para análise humana. Não contém credenciais, destinos de serviços reais ou código de provisionamento.
- **Testes do contrato** `tests/commercial-staging-readiness.test.cjs`: 14 testes negativos e positivos, incluindo SQL sabidamente inseguro, permissões por empresa, obrigatoriedade de evidência, rejeição de dados sensíveis, integridade do checklist e proibição de concluir que um teste equivale a autorização para staging ou deploy.
- **Baseline:** 15 verificações `NOT_RUN`, duas `BLOCKED` (`SQL-01` e `SQL-02`). **0/17 aprovadas em staging**. Testes executados anteriormente em PGlite/Chromium demonstram viabilidade das fixtures, não substituem evidência de homologação num projeto segregado autorizado.
- **Proteção operacional:** manter `player.js`, `android-player/`, gateway, APIs operacionais, playlists e estado de TVs de clientes intocados. Sem deploy, sem publicação Edge Function, sem migração, sem conexão ao Storage real.

## Pré-condição obrigatória para qualquer sessão futura de staging

Antes de iniciar, obter autorização explícita separada para um **projeto Supabase de teste distinto**, com URL/configuração revisada sem expor tokens; contas de anunciante A/B e estabelecimento apenas sintéticas; bucket privado próprio; nenhuma cópia de mídia ou credencial de cliente; plano reversível limitado ao staging. A mudança SQL segura também precisará de revisão e autorização específicas **antes de aplicar** em qualquer projeto, inclusive staging. Um teste aprovado não concede autorização para deploy na produção.

## Matriz de aceite — 17 requisitos de bloqueio

| ID | Status atual | Verificação e resultado esperado | Evidência obrigatória em staging |
|---|---|---|---|
| ENV-01 | NÃO EXECUTADO | Projeto, credenciais, bucket e objetos isolados; nenhum endpoint de produção e nenhuma TV real | Inventário de ambiente, distinção staging/produção, autorização humana |
| ENV-02 | NÃO EXECUTADO | Anunciante A, anunciante B, Master, dono do ponto, anônimo e estranho com identidades **sintéticas** | Manifesto de fixtures e matriz de papéis sem dados pessoais |
| SQL-01 | **BLOQUEADO** | `authenticated` não consegue `SELECT` em `source_media_id`, `source_storage_path`, `source_updated_at`, `checksum` nem `SELECT *` indiscriminado | Testes negativos de SQL/GRANT por papel + projeção explícita |
| SQL-02 | **BLOQUEADO** | RPC `SECURITY DEFINER` expõe só campos comerciais permitidos; nenhuma coluna ou caminho original | Esquema efetivo redigido da RPC e verificação de resposta A/B |
| RLS-01 | NÃO EXECUTADO | A só vê campanhas/cópias A; B só B; ponto/estranho/anônimo não acessam dados comerciais | Matriz de negações SQL/RPC/Storage e status HTTP |
| RLS-02 | NÃO EXECUTADO | Desabilitar A nega novas consultas/assinaturas sem interromper B | Evidência antes/depois com tokens ocultos |
| COPY-01 | NÃO EXECUTADO | Prévia usa snapshot independente `commercial-ads/<UUID>`, sem ler/alterar mídia original nem playlist do ponto | Inventário sintético de objetos e diff das referências de playlist |
| URL-01 | NÃO EXECUTADO | Assinatura só da cópia autorizada, com solicitação de TTL **até 60 segundos**, host/caminho validados | HTTP status e tempo de validade observados; nunca gravar URL assinada |
| URL-02 | NÃO EXECUTADO | Novas assinaturas A negadas após bloqueio; verificar **separadamente** o link previamente emitido | Série temporal 200/403 com cache e origem separados |
| CDN-01 | NÃO EXECUTADO | Medir status, cabeçalhos de cache, cache por token, reuso, expiração na origem e resposta do CDN | Relatório sem tokens, cabeçalhos permitidos, contagem de bytes e relógios |
| VIDEO-01 | NÃO EXECUTADO | Imagem verdadeira e MP4 H.264 decodificados; `206`/`416`; vídeo ausente/corrompido mantém painel funcional | Capturas e teste de `loadedmetadata`, término, Range e fallback |
| WEBVIEW-01 | NÃO EXECUTADO | Android/WebView **dos dispositivos-alvo de bancada**, sem usar TV de cliente, suporta login, formatos, ESM, fetch e vídeo | Matriz de versão exata, emulador/dispositivo e logs redigidos |
| SESSION-01 | NÃO EXECUTADO | Logout, troca de conta, RPC 403, refresh e respostas atrasadas não remontam mídia nem restauram dados | Scripts Chromium com respostas adiadas e testes de limpeza de sessão |
| LOG-01 | NÃO EXECUTADO | Console, logs de API/CDN, screenshots e artefatos sem JWT, URL assinada, cabeçalho Bearer ou caminho original | Varredura de sigilos e relatório de redaction; **não anexar segredos** |
| COST-01 | NÃO EXECUTADO | Uso mensurado (GETs, Range, bytes, cache, erros, função/CPU), contrato atual, franquias, limite de custos aprovado | Tarifas vigentes do contrato e métricas de staging, sem precificação fictícia |
| DECISION-01 | NÃO EXECUTADO | Vision aprova **A** (janela residual aceita) ou **B** (novos GET/Range autenticados), incluindo risco de cache e WebView | Decisão escrita, aceite de risco, revisão técnica e humana |
| ROLLBACK-01 | NÃO EXECUTADO | Plano de reversão **somente staging**, com preservação comprovada de player, APK e playlists | Diff de arquivos operacionais e ensaio de rollback sem dados reais |

**Regra de aprovação:** os 17 critérios devem estar `PASS`, com evidência apropriada e revisão humana; `NOT_RUN`, `BLOCKED`, `FAIL` ou registro sem prova bloqueiam a avaliação. Mesmo que todos ficassem `PASS`, o verificador retorna `canRunRealStaging:false` e `canDeployToProduction:false`: somente uma autorização explícita separada pode permitir tais ações.

## Bloqueio concreto de SQL identificado

O arquivo de revisão `supabase/sql/advertiser-portal.sql` ainda possui `grant select on public.vision_commercial_revisions ... to authenticated` e retorna `jsonb_agg(to_jsonb(r))`, expondo `source_storage_path`, `source_media_id`, `source_updated_at` e `checksum` ao anunciante autorizado à linha. **RLS por linha não resolve divulgação de colunas** e uma função `SECURITY DEFINER` precisa sanitizar a própria resposta. A correção validada anteriormente existe **apenas** em `tests/fixtures/commercial-safe-projection-lab.sql`, com PGlite in-memory. Não executar esse patch diretamente em banco real nem publicar o portal comercial antes de revisão, correção e homologação.

## Plano de execução futuro (não executado)

**Fase 1 — Preparação aprovada:** confirmar segregação do projeto, credenciais/usuários fictícios, dono responsável e escopo de rollback. Não reutilizar project ref de produção. Validar que a revisão do SQL seguro **não** altera campanhas/playlists operacionais.

**Fase 2 — Autorização e isolamento:** validar acesso A/B por RPC, SELECT direto e Storage; provar que mídia original, terceiros e contas inativas são recusados. Coletar apenas evidências redigidas.

**Fase 3 — Entrega e ciclo de sessão:** observar assinatura/TTL real, cache e propagação, URLs host/path, logout e revogação; testar imagens, MP4 H.264, `206/416`, falhas de Storage e WebView de teste. Uma URL já emitida pode continuar acessível até expirar e uma cópia cacheada pode sobreviver: não prometer revogação retroativa.

**Fase 4 — Custo e decisão:** coletar bytes reais, GETs, cache, taxa de falhas e consumo por amostra, consultar **tabela de preços do contrato efetivo** e limites de franquia, obter aceite da janela residual (assinatura curta) ou da complexidade de proxy por GET/Range. A tabela de 27 cenários anterior é apenas **sensibilidade hipotética**, não preço nem utilização real da Vision.

**Fase 5 — Revisão humana:** arquivar artefatos sem segredos, validar os 17 itens, registrar pendências e formalizar aprovação específica para o próximo procedimento. **Nunca promover para produção por passar CI.**

## Histórico reaproveitável, sem confundir com evidência de staging

- Projeção segura PGlite de laboratório e isolamento A/B: `tests/commercial-rls-safe-projection-lab.test.cjs`.
- Sessão/logout e mídias atrasadas no Chromium: `tests/browser/commercial-portal-sanitized-browser.cjs`.
- MP4 H.264 verdadeiro, Range `206→403` e cache fictício: `tests/browser/commercial-video-range-revocation-browser.cjs`, `tests/browser/commercial-signed-url-cache-browser.cjs`.
- Medições locais e 27 cenários simulados: `docs/implementation/commercial-delivery-sensitivity-checkpoint.md`. Nenhuma dessas provas usou Supabase real.

## Próxima etapa recomendada

Preparar um **formulário de evidências redigidas por requisito**, também isolado no repositório e validado por testes, para que um futuro staging autorizado possa gerar relatório `PASS/BLOCKED` auditável. **Não executar staging, não migrar SQL, não implantar proxy ou URLs comerciais reais e não alterar player/TV sem permissão específica.**
