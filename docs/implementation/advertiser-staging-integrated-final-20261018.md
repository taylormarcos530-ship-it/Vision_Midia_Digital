# Fechamento da aceitação integrada do Portal do Anunciante — 18/10/2026

**Referência:** `fix/advertiser-staging-security-gate-20261018`, proveniente do checkpoint `ad04219`.

## Resultados adicionais comprovados

- Executado teste transacional integrado no Supabase de homologação `jmiuitrrhtaeyrpuyohk`, usando as **funções SQL reais**, além dos testes previamente aprovados: armazenamento fictício *somente metadados*, cópia obrigatória antes de salvar campanha, revisão separada, vínculo com TV fictícia offline e manifesto ativo.
- Conferidos `4` eventos simulados, `2` conclusões válidas e apenas `1` linha agregada de relatório após repetição de recálculo; os dados fictícios do anunciante A não apareceram no relatório B.
- Uma campanha pausada e um anunciante arquivado deixam de aparecer no manifesto.
- O caminho original da mídia não é divulgado no relatório, e a origem operacional permanece inalterada.
- `ROLLBACK` obrigatório e concluído; conferência posterior: `0` empresas, TVs, mídias, logs, revisões, vínculos, agregados e objetos Storage. Preservados os 3 anunciantes de teste, 2 campanhas ilustrativas e 1 rascunho do Vision Menu.
- Testes anteriores em Chromium: relatório móvel e desktop, troca isolada de anunciantes, player local e decodificação de MP4 H.264 real sem qualquer chamada à rede.
- Regressão completa executada no checkpoint anterior: `686/686` PASS. A nova verificação do SQL usa `tests/commercial-staging-integrated-rollback.test.cjs`, não escreve no Supabase e não é invocada automaticamente pelo CI como SQL remoto.
- Produção oficial permanece em `921f365b7f1ee5c7da7c96b74b3cdf1462e180c3`.

## Reproduzir com segurança

O roteiro SQL seguro está em `tests/sql/commercial-staging-integrated-rollback.sql`. **Somente executar após conferir explicitamente o projeto de homologação**. Usa `BEGIN` e `ROLLBACK`, gera IDs aleatórios, bloqueia ambientes inesperados, testa a lógica de ponta a ponta e não usa senha nem e-mails reais.

## Limite de aceitação e decisão

**Aprovado até aqui:** segurança de acesso do anunciante, fluxo de cadastro e senha, backend SQL de campanha/manifesto/relatórios, contagem e revogação, execução no navegador e reprodução local do MP4.

**Ainda não demonstrado:** upload/cópia reais de bytes via Supabase Storage, obtenção de URLs assinadas em execução integrada, autenticação e telemetria do dispositivo físico, comportamento da grade no TV Box com anúncios reais. O `master-admin` em homologação **bloqueia propositalmente** `commercial_save_campaign`; o gateway de TV não foi publicado nesse ambiente.

**Não classificar como pronto para anunciantes reais:** o go-live exige teste de integração com Storage real e um piloto físico autorizado num equipamento controlado. Não alterar ou promover produção, player, APK, Edge Functions ou playlists reais sem aprovação específica. Não recomeçar verificações concluídas.
