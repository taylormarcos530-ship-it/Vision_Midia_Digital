# Vision Mídia Digital — encerramento da homologação técnica do Portal do Anunciante

**Data:** 18/10/2026  
**Projeto Supabase de homologação:** `jmiuitrrhtaeyrpuyohk`  
**Branch de homologação:** `fix/advertiser-staging-security-gate-20261018`  
**Estado:** testes isolados concluídos; **NÃO é aprovação de publicação comercial em produção**.

## Escopo entregue

1. Cadastro de conta fictícia pelo Master, senha temporária, primeiro login e redefinição: confirmados em navegador de usuário e registros Supabase Auth.
2. Regras de segurança da homologação: coluna `source_storage_path`, `source_media_id`, `source_updated_at` e `checksum` inacessíveis a `authenticated`; RPC privado não executável; acesso RLS por anunciante preservado.
3. `master-admin` comercial isolada publicada apenas em Supabase homologação, versão 1, `verify_jwt=true`, restrita a operações de contas — sem gravação de campanhas ou operações de TV/playlist.
4. Regressão em branch `a1e0d2b`: **686/686 testes PASS** (`npm test`).
5. Teste SQL real no staging com transação `BEGIN`/`ROLLBACK`: 4 registros de reprodução **simulados**, apenas 2 conclusões válidas, 1 agregado diário, recomputação idempotente, TV fictícia offline e dados do anunciante A ausentes para B. **Não houve reprodução de tela física nem gravação persistente de impressões falsas.**
6. Teste de navegador Chromium real (desktop e mobile), com interceptação local de TODAS as chamadas Supabase e contas falsas: relatório exibe `2` hoje e `2` total para anunciante A; ao sair e entrar no anunciante B, só aparece a campanha B e métricas zeradas. TV simulada offline; sem vazamento entre anunciantes, sem erros JavaScript, nenhuma chamada externa real.
7. Player **local de bancada** testado em Chromium mobile: inicia, simula desconexão/reconexão, não faz solicitações à rede.
8. Um vídeo MP4 H.264 real de 1,1 segundo foi gerado somente na sandbox, reproduzido e decodificado pelo Chromium; evento `ended` avançou do item 1 ao item 2 de 8. Sem requisições Supabase ou erros JavaScript. **Não é prova de funcionamento no APK/TV Box físico.**

## Verificação após testes

- `public.companies`: 0; `devices`: 0; `media_assets`: 0; `playback_logs`: 0.
- Revisões, vínculos com TVs e agregados comerciais: 0.
- Três anunciantes fictícios, duas campanhas ilustrativas e um Master de homologação mantidos.
- `vision_menu_lab.vision_menu_drafts`: 1, preservado.
- A permissão privada `source_storage_path` continua negada.
- Vercel produção oficial mantida em `921f365b7f1ee5c7da7c96b74b3cdf1462e180c3`. Nenhum deploy ou alteração de produção.
- Não houve alteração em player oficial, APK, programação/playlist, Supabase de produção ou contas de clientes.

## Limites materiais para go-live

**A homologação de navegador e contabilização isolada foi encerrada, não a implantação comercial real.** Sem validação de um fluxo real no staging envolvendo cópia autorizada de mídia, Storage/RLS/URL assinada, campanha vinculada a dispositivo de bancada, entrega e telemetria de reprodução real com assinatura de origem, não afirmar que a exibição real foi demonstrada. A Edge de cadastro atualmente bloqueia salvar campanhas de propósito.

**Não tocar nas TVs reais para encerrar testes.** O teste físico do player/TV Box requer operador no dispositivo, equipamento disponível e autorização específica. Publicação de produção, migrações de produção, backend `device-gateway`, intercalamento nos players e habilitação de anunciantes reais requerem aprovação separada, com revisão de compatibilidade e rollback.

## Decisão de encerramento

**Aprovado:** fluxo de contas e proteção de privacidade em homologação, regressão, UI de métricas com dados sintéticos e reprodução local de vídeo pelo navegador.  
**Pendente de evidência independente:** piloto físico de entrega comercial, implantação integrada do backend e autorização de go-live.  
**Próxima operação (não executada):** planejar piloto físico controlado; não repetir os testes já concluídos sem alteração comprovada.
