# Vision Menu Digital — proposta de persistência e publicação segura

**Estado: proposta isolada, NÃO implantação.** A branch oficial, o Supabase e as TVs não devem executar estes arquivos sem autorização posterior.

- `menu-contract.mjs`: valida template, produtos, preços em centavos, 8 itens visíveis, arquivos privados da mesma empresa, papéis e autorização por tenant. Módulo puro, sem rede.
- `menu-service.mjs`: serviço **somente em memória** para testar concorrência lógica, revisões imutáveis, idempotência, trilha de auditoria e intenção de publicação fictícia. Não é o backend real.
- `vision-menu-schema.DRAFT.sql`: proposta de tabelas, RLS de leitura, RPCs de escrita autenticada e intenção de publicação que **nunca ativa** uma TV. Não fica em `supabase/migrations`. Precisa de PostgreSQL 17, revisão independente e ensaios A/B antes de poder ser aplicada.

## Contrato

- Empresa identificada por `company_id` vindo de uma sessão validada no backend; nenhum valor do navegador substitui checagem de `auth.uid()`/RLS.
- A gravação do rascunho é serializada por menu e exige `expected_revision` (controle de concorrência). `request_id` permite repetição idempotente de pedido idêntico, sem duplicação.
- Cada revisão armazena snapshot integral e imutável: nunca altera versões anteriores. Preços são inteiros em centavos; grupos de 8 são responsabilidade do compositor do player.
- Logo/vídeo referenciam `media_assets` do mesmo tenant, `ready` e armazenados no bucket existente. Seleção não duplica arquivos.
- Intenções de publicar são sempre `active=false`, com estados `normal_untouched` ou `review_required`; não geram atribuições, cache novo, playback logs ou comandos às TVs.
- Modo `menu_only` e `interleave` **não ficam habilitados** até a prioridade da campanha comercial, transições do player, cache offline, monitoramento e sinais de entrega serem homologados.

## Gates finais, sem novos MVPs desnecessários

1. **Contrato isolado:** testes Node e SQL revisado estaticamente. Não é liberação backend.
2. **Homologação real:** aprovação do proprietário para migration isolada + Edge de homologação; executar PostgreSQL/RLS multiempresa, testes de concorrência, seleção da biblioteca, integração player/campanhas e suíte de regressão completa.
3. **TV piloto e liberação:** autorização separada, teste com falha de rede/reinício e validação operacional, antes de qualquer produção.

Dívidas conhecidas antes de integrar: imagem final licenciada da Casa de Carnes; garantir codec do vídeo; HTTP real; verificar versões reais de schema; representação do menu no manifesto sem alterar `playlistNonce` a cada atualização; política de intercalamento comercial; migração com política de rollback restrita. Não adaptar player ou painel nesta etapa.
