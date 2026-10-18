# Vision Mídia Digital — integração comercial: aceitação técnica e gate único de go-live

**Data:** 18/10/2026  
**Projeto:** `taylormarcos530-ship-it/Vision_Midia_Digital`  
**Branch isolada:** `fix/advertiser-staging-security-gate-20261018`  
**Código integrado verificado:** `45e299e44e7cc65913b73018cf575c669317acd5`  
**GitHub Actions:** https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/39148908847

## Entregue — evidência objetiva

- `726/726` testes locais automatizados aprovados em Node.js 22, falhas `0`, testes ignorados `0`.
- Novo contrato integrado (`tests/commercial-master-to-advertiser-e2e.test.cjs`) usa os módulos reais `commercialMaster`, `saveCommercialWithSnapshot`, `augmentCommercial`, `decorateCommercialRows`, `refreshCommercialDaily`, o código de prioridade do Player e o SQL comercial em PostgreSQL descartável.
- A simulação cria **dois anunciantes independentes**, salva campanhas pelo fluxo Master, copia mídias de origem para revisões comerciais próprias, monta **seis mídias do estabelecimento e dois anúncios nas posições 4 e 8**; depois registra reproduções válidas e inválidas, recalcula métricas duas vezes e consulta os relatórios reais com roles autenticados de anunciantes distintos.
- Cada anunciante só vê sua campanha; 1 reprodução concluída por anunciante no ensaio, com tentativas corretas; a consulta Master lê o mesmo agregado. Playlist e mídias do estabelecimento não são modificadas.
- `player.js` candidato prioriza mídias novas do estabelecimento, não anúncios; rotação comercial só avança após rodada completamente concluída. Testes adicionais cobrem ciclos e bloqueios de players incompatíveis.
- Homologação remota anterior de TV virtual + Storage assinado + relatório foi aprovada **sem TV física**; não é substituto para piloto em hardware.

## Estado operacional observado — não presumir deploy

- Supabase oficial `fpadgedrgcxrrqflzhjt`: a consulta de leitura em 18/10/2026 não encontrou tabelas `vision_commercial_*` nem `vision_advertisers`.
- Supabase oficial possui `device-gateway` v15 e `master-admin` v6: versões operacionais que **não são** a liberação do candidato comercial.
- Supabase isolado `jmiuitrrhtaeyrpuyohk`: `master-admin` de homologação aceita operações de conta, mas **não** libera `commercial_save_campaign` manual; `commercial-virtual-gateway` opera apenas TVs fictícias. Este bloqueio é deliberado.
- A TV Life fundo não recebeu comandos, mídias, token, atualizações ou alterações de playlist nesta etapa.
- Nenhum merge, migration, Edge Function ou deployment de produção foi realizado.

## Único caminho restante para liberação real (GO/NO-GO)

1. **Avaliação final no staging isolado:** homologar a rota administrativa de salvamento de campanha sem abrir publicações fora de TVs fictícias; validar Storage real, origem independente e relatórios com acesso de dois anunciantes. O teste automatizado já cobre a regra de negócio, e a homologação virtual anterior cobre os bytes; não refazer essas provas sem necessidade.
2. **Publicação selecionada, nunca merge integral:** preparar separadamente o schema/RLS/RPCs comerciais de `supabase/sql/advertiser-portal.sql` com backup e avaliação de privilégios; gateway e shared helpers; `master-admin` e shared helpers; interfaces comerciais. Preservar `Vision Menu` e as outras funções existentes.
3. **Habilitação sempre fail-closed:** `VISION_COMMERCIAL_ENABLED` deve ficar desligado por padrão; `VISION_COMMERCIAL_PILOT_DEVICE_IDS` deve conter **apenas** UUIDs autorizados. O gateway exige também capacidade de rodadas do Player. Não incluir identificadores reais neste repositório.
4. **Piloto físico supervisionado:** escolher UMA TV e janela aprovada no local; registrar baseline da programação; testar exibição 4/8, rotação, conectividade, vídeo/áudio e relatório de exibições **realmente concluídas**; encerrar com verificação de playlist original. Nenhum anúncio real fora da janela.
5. **Rollback comprovado:** desligar a flag comercial, verificar manifesto apenas com as seis mídias do ponto e confirmar no dispositivo. Não apagar nem sobrescrever mídia/playlist do cliente. Não remover schema ou histórico para interromper o piloto. Se falhar, NÃO avançar para outras TVs.

### Autorizações protegidas que ainda não foram concedidas

Produção: aplicar SQL/migrations comerciais, publicar gateway/Master/Player, alterar flags, instalar/atualizar APK ou acionar TV real — **não executar sem autorização explícita para cada ambiente**. É possível validar o código e preparar diffs/artefatos sem efetuar essas operações.

### Critério definitivo de encerramento

**Pronto tecnicamente em branch isolada** se regressão completa PASS e contratos Master → anúncio → Player → relatórios mantidos. **Pronto para vender/exibir anúncios reais** somente após schema/Edge/site publicados com autorização, flag individual e piloto real concluído com rollback demonstrado. Não confundir esses dois estados. Não criar novos checkpoints para a mesma validação.

**Decisão atual:** código candidato e prova integrada **PASS**; liberação real **NO-GO** até implantação autorizada e piloto controlado.
