# Portal do Anunciante — entrega em branch de teste

Branch inicial: `feat/advertiser-transparency-portal`. Branch de segurança e snapshots: `fix/advertiser-portal-safety-20261013`. Base preservada: `4fd78802fc9ae4f8840fbfa1514cf9f467aaf39e`. Produção observada: `921f365b7f1ee5c7da7c96b74b3cdf1462e180c3`.

## Implementado no código

Administração exclusiva Master, criação de conta Auth separada com senha temporária, redefinição de acesso, desativação sem apagar histórico, campanhas comerciais com mídia versionada e múltiplos pontos, portal somente leitura, métricas de eventos concluídos, histórico diário e heartbeat existente. Nenhuma senha é gravada nas novas tabelas. O e-mail de uma identidade existente não é reaproveitado nem alterado pelo formulário.

A camada opcional acrescenta anúncios ao manifesto em memória, após três itens normais, sem atualizar a playlist armazenada. Campanhas operacionais permanecem separadas. Playlists vazias, aleatórias, modo único, agendas por item, fusos diferentes de São Paulo e players sem agenda por item não recebem inserções; há diagnóstico no Master. Limite inicial de 20 campanhas comerciais simultâneas por TV, validado ao salvar.

Sem alteração em player.js, APK ou protocolo de eventos. Neste checkpoint, uma cópia independente do arquivo é criada no bucket privado existente (prefixo `commercial-ads/`) somente ao cadastrar/trocar a mídia de uma campanha. O original do estabelecimento não é movido, apagado ou bloqueado. A revisão comercial guarda o caminho da cópia e a referência imutável à origem; alterar datas/status sem alterar o arquivo não o duplica. Em falha de cópia, a campanha não é salva. Arquivos cuja vinculação não pôde ser confirmada não são apagados automaticamente. Reutiliza playback_logs com UUID da revisão comercial como media_id. Trocar arquivo preserva a campanha. Totais vêm de completed=true com datas válidas; programação e heartbeat nunca geram exibições. Offline pode enviar registros reais acumulados ao reconectar.

## Segurança de implantação

NÃO foi aplicada migration ou SQL remoto. NÃO foi publicada Edge Function. Nenhum cadastro, mídia, playlist ou TV de produção foi modificado. Os dois hooks novos nas funções existentes ficam desligados sem VISION_COMMERCIAL_ENABLED=true. commercial-config.js permanece desabilitado e sem credenciais.

O preview demonstra a interface com dados explicitamente ilustrativos e contadores zerados. Não é uma validação de reprodução em TV real nem de autenticação no Supabase remoto. O login real requer homologação isolada; não apontar este módulo para produção para testar.

## Verificação

- Antes dos patches: 81 testes existentes aprovados.
- Checkpoint original: 92/92 testes Node aprovados, incluindo PostgreSQL local PGlite com RLS real e papéis anon/authenticated/service_role.
- Checkpoint segurança/snapshots (13/10/2026): **97/97 testes Node aprovados**, incluindo regras de roles, snapshot independente, prevenção de duplicação, falha na cópia, reparo de órfãos confirmado e teste de SQL/PGlite. CI: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38483413075 .
- Chromium/Playwright local: 12 verificações aprovadas, zero erros de página. Larguras 320, 390, 768 e 1280; login/novo login, bloqueio, logout com resposta atrasada, Master cria anunciante/campanha/seleciona TV/desativa usando fixtures locais.
- Testes de banco: A não vê B, dono do ponto não vê anunciantes, escrita e RPCs administrativas negadas, JWT ativo sem acesso após desativação, miniatura restrita, troca de mídia preserva histórico, repetição da consolidação não duplica e falha superior a 48h pode ser reconciliada.
- Revisão independente executada; corrigidos logout tardio, janela de consolidação, identificação comercial nos relatórios e diagnóstico de entrega.
- Executar `npm ci --ignore-scripts && npm test`. Teste de navegador: `node tests/browser/commercial-browser.cjs` com Playwright/Chromium disponíveis; VISION_TEST_CHROMIUM e VISION_TEST_CHROMIUM_ARGS permitem usar binário local.

## Estruturas novas (somente script)

vision_advertisers, vision_commercial_campaigns, vision_commercial_revisions, vision_commercial_targets, vision_commercial_daily. As revisões comerciais incluem `source_storage_path` e `source_updated_at` para confirmar se uma cópia nova é necessária; `storage_path` aponta para a cópia no prefixo privado `commercial-ads/`. RLS, RPCs restritos e política SELECT de miniatura no Storage. Script transacional revisável: supabase/sql/advertiser-portal.sql. Sem alterações em tabelas operacionais.

## Pendências antes de qualquer ativação

1. Provisionar/selecionar Supabase de homologação isolado, instalar o esquema atual e este script, publicar ali as duas funções EXISTENTES modificadas e configurar o portal somente para esse ambiente.
2. Validar Auth completo, Master, dois anunciantes e uma TV de teste ponta a ponta, incluindo agenda/expiração, reconexão e acesso do dono do ponto.
3. Medir o custo da consolidação com volume representativo: hoje recompõe os dias comerciais de cada TV a partir dos logs existentes. Não ativar em grande escala sem essa medição. Não há retenção destrutiva automática nem nova telemetria paralela; uma política de retenção precisa preservar também o relatório atual. A economia de armazenamento solicitada ainda não está concluída.
4. Validar falhas de RPC de rótulos: em indisponibilidade, o batch original é preservado para não perder telemetria; o relatório operacional pode manter rótulo de mídia removida/campanha operacional para esse evento. Resolver esse caso antes de ativar campanhas comerciais reais.
5. Isolamento dos papéis reforçado no SQL novo: triggers aditivas impedem que um anunciante seja depois inserido como membro, Master ou proprietário do ponto. Passou no PostgreSQL local; **validar também com o esquema real em Supabase isolado** antes da ativação.
6. Snapshots de mídia independentes implementados no Master e testados com mocks + PostgreSQL local. **Validar a cópia do Storage real em homologação** (permissões, MIME, assinatura da miniatura, exclusão da mídia de origem). Cada nova revisão distinta ocupa espaço no Storage; não remover snapshots referenciados por relatórios/histórico. Não ativar limpeza automática sem política de retenção verificada.

Esta branch não está autorizada para produção. A decisão de ativação depende das verificações acima e de aprovação do responsável.

## Arquivos alterados/adicionados

- `advertiser-portal.mjs`
- `anunciante.html`
- `commercial-config.js`
- `commercial-ui.mjs`
- `commercial.css`
- `docs/implementation/advertiser-portal-plan.md`
- `master-advertisers.html`
- `master-advertisers.mjs`
- `supabase/functions/_shared/commercial-master.mjs`
- `supabase/functions/_shared/commercial.mjs`
- `supabase/functions/_shared/commercial-media.mjs`
- `supabase/sql/advertiser-portal.sql`
- `tests/browser/commercial-browser.cjs`
- `tests/commercial-db.test.cjs`
- `tests/commercial-snapshot.test.cjs`
- `.github/workflows/advertiser-portal-safety.yml`
- `tests/commercial-session.test.cjs`
- `tests/commercial-ui.test.cjs`
- `tests/commercial.test.cjs`
- `index.html`
- `master.html`
- `package-lock.json`
- `package.json`
- `supabase/functions/device-gateway/index.ts`
- `supabase/functions/master-admin/index.ts`
- `docs/implementation/advertiser-portal-delivery.md`
