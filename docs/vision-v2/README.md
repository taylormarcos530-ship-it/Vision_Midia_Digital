# Vision Mídia Digital V2 — Fundação isolada e plano de homologação

**Data:** 31/10/2026. **Estado:** F0 concluída; **NÃO PUBLICAR, NÃO CONECTAR TVs**.
**Organização Supabase:** Ofertas TV (Free). **Projeto V2:** `yuwvgpvwgeowhgtxssvr` (São Paulo, `sa-east-1`).
**GitHub:** branch `feature/vision-v2-isolated-foundation-20261031`, originada de `fix/playback-daily-retention-safe-20261030`. Branch `main` e Vision em produção não foram alteradas.

## Objetivo e escopo
Construir backend otimizado para a Vision sem perder o painel Master, playlists, campanhas, biblioteca de mídias, monitoramento, offline, rotação, quiosque, cadastro multiempresa e comprovantes comerciais. **Não copiar a sobrecarga do backend legado.**
A V2 não é uma instalação operacional ainda: o painel e o APK atual ainda apontam para o Supabase original.

## F0 — Trabalho EXECUTADO
1. Criado projeto gratuito V2 separado; custo mensal informado na criação: `0`.
2. Aplicada SOMENTE no projeto V2 a migração `vision_v2_qa_foundation_20261031`. Fonte: [qa-foundation.sql](qa-foundation.sql).
3. Criado esquema interno **`vision_v2_qa` não exposto via Data API**, seis tabelas:
   - `companies`: empresas QA.
   - `devices`: TVs QA e versão do manifesto, sem atualizar o DB em toda consulta.
   - `manifest_revisions`: manifesto com revisão e SHA-256 para sincronização condicional.
   - `playback_event_keys`: ledger de IDs SHA-256 por TV, sem apagar a identidade no rollover do bruto.
   - `playback_recent`: recibos individuais recentes (sem retenção/limpeza ativa).
   - `playback_daily`: contagens diárias por empresa, TV e mídia.
4. RLS ativada nas seis tabelas, sem políticas que liberem acesso, e revogado acesso direto de `anon`/`authenticated`. Sem `service_role` no APK, sem Edge Functions, sem cron e sem migração de dados reais.
5. Teste sintético **SQL PASS**: 20 TVs QA, 10 IDs cada, **200 identidades únicas** e **200 recibos**; reenvio dos mesmos IDs -> **0 novas identidades**, total diário = **200**, acesso `anon/authenticated` negado pelo esquema. O ensaio rodou em subtransação revertida: **0 empresas, 0 TVs, 0 identidades, 0 recibos e 0 resumos** após o teste.
6. Consultas de verificação: seis tabelas presentes, todas com RLS ativada; migração registrada; **0 Edge Functions** publicadas na V2.

### Avisos técnicos que NÃO devem ser ocultados
- Advisory de segurança: `rls_enabled_no_policy` em 6 tabelas (INFO). **Intencional** nesta fase: não existe portal autenticado nem API conectada. Antes de expor tabelas, implementar políticas de isolamento reais e tests.
- Advisory de performance: 2 FKs compostas sem índice cobrindo exatamente `(company_id,device_id)` em `playback_recent` e `playback_daily`. **Não criar índices indiscriminadamente**: decidir com `EXPLAIN (ANALYZE, BUFFERS)` sobre massa sintética e custo de escrita, pois índices excessivos foram problema na V1.
- SHA-256 de ID serve para deduplicação com risco de colisão desprezível, mas não matematicamente zero; o backend futuro deve recalcular a partir do evento autenticado, com tratamento de mensagens inválidas e concorrência.
- Este teste **NÃO** comprova idempotência da API/Edge, corrida concorrente, durabilidade sob disco cheio, desempenho de 100 TVs nem compatibilidade de painel.
- O banco ainda não faz compactação automática. Não ativar `DELETE`/cron até comprovar replay, total comercial e backup restaurável.
- A organização Ofertas TV possui outro projeto ativo com 34 tabelas; quotas de Edge, egress e outros usos são compartilhadas na organização. `0` na cotação de criação não significa capacidade ilimitada ou consumo zero.

## Diagnóstico da V1 a evitar na V2
- Em leitura da produção, `playback_logs` tinha cerca de 210 mil linhas estimadas, 53 MB de tabela, 140 MB de 12 índices e 193 MB totais. **Não repetir 12 índices sem observar consultas reais**.
- Um envio em lote diminui HTTP, mas cada reprodução ainda representa gravação; a V2 precisará **ACK idempotente** e consolidação robusta, com ledger de identidades, agregados reconciliados e retenção monitorada.
- O gateway da produção inclui otimizações de 60s e função `device-bundle-stable` v3, mas a V2 ainda precisa validar a implementação real e se o APK a utiliza.
- Offline/cache e quiosque devem continuar, preservando autorização legítima e prazo de concessão; não autorizar TV arbitrariamente sem servidor.
- Queda do Supabase não deve iniciar loops de requisições ou sobrescrever comprovantes locais.
- A V30 sintética já mostrou paridade de resultados e também armadilhas de crescimento físico de ledger `bytea` monolítico; ver os relatórios `docs/vision-v30-*.md` do repositório. **Não copiar abordagem que reescreve blobs crescentes**.

## Próximas fases — não executadas ainda
**F1. Contratos e segurança:** mapear o código exato do Master/painel, `config.js`, Auth/RLS, Storage, pareamento e tipos SQL do legado; desenvolver `device-v2` isolado com token/tenant validado, manifesto versionado condicional, regras reais de acesso e resposta consistente. Não usar credenciais de produção no novo projeto.

**F2. Eficiência mensurável:** projetar uma chamada agrupada e ACK idempotente de eventos em lotes; atualizar `last_seen_at` apenas quando necessário; agregação por lote e ledger de segmentos de tamanho limitado. Medir Edge invocations, transferência, requests SQL, CPU/I/O, índices e bytes por milhão de eventos. Projetar limpeza apenas com backup, archive, reconciliação e testes de replay tardio.

**F3. QA isolado real:** testar `npm test`, Deno/Edge, PostgreSQL 17, JWT/RLS, controle Master, Storage e relatórios com dados sintéticos de 7, 12, 20, 50 e 100 TVs. Incluir quedas, erro 400/500, comandos atrasados, relógio incorreto, reconexão, falta de espaço, concorrência e duplicação. Usar contêiner/instância isolada, **não usar TVs reais para carga**.
- PASS = zero perda/duplicação no domínio coberto, nenhum cruzamento de empresas, relatórios antigos e novos equivalentes, sem regressão de comandos/cache.
- PASS de capacidade = uso projetado dentro do plano escolhido, folga **>=30%** sobre limites relevantes; confirmar tamanho, Edge, egress, throughput e I/O, não apenas número de registros.
- FAIL = qualquer duplicação, perda, travamento, acesso indevido, custo acima da capacidade ou rollback não demonstrado.

**F4. APK separado:** preparar APK de homologação com projeto V2/ambiente QA, nova assinatura/configuração controlada, sem substituir o APK estável; validar uma TV Casa com autorização separada.

**F5. Migração e rollback:** só após backup criptografado **real** da V1 (inclui PostgreSQL, Storage e configuração), restauração testada e mecanismo para preservar mudanças posteriores; migrar primeiro uma TV, auditar 7 dias, expandir por lotes. Não alterar produção, `main`, Vercel oficial ou TVs sem aprovação de rollout.

## Estado PASS/FAIL em 31/10
- PASS — projeto novo ativo, esquema QA isolado criado, seis RLS ativadas, sem API pública, teste sintético 20 TVs/200 recibos/0 duplicações, rollback do teste.
- PENDENTE — auth, interface Master, Edge, Storage, ingestão real, 100 TVs em carga, backup real, APK de QA e deploy.
- NO-GO — conectar clientes ou trocar domínio/site oficial, migrar banco real, apagar histórico ou anunciar que V2 já está pronta.

**Links:** [projeto Supabase V2](https://supabase.com/dashboard/project/yuwvgpvwgeowhgtxssvr) · [runbooks V30](../vision-v30-final-storage-age-casa-qa-20261031.md).
