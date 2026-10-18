# Vision Menu Digital — Backend de homologação (proposta não aplicada)

Origem: `feature/vision-menu-digital-mvp-isolated` em `99c45dedf881c012f96caa4ae31a76bf3965d683`. A branch original continua `fix/advertiser-portal-safety-20261013` em `f813240`.

Arquivos novos exclusivos do laboratório:

- `integration/menu-contract.mjs`: validações de preços, 8 itens por grupo, ativos privados e autorização.
- `integration/menu-service.mjs`: simulação em memória de revisões, idempotência, controle de concorrência, intenção de publicação, auditoria e isolamento por empresa. **Não é serviço implantado.**
- `integration/vision-menu-schema.DRAFT.sql`: modelo SQL com tabelas/RLS e RPCs para gravação e intenção. **Não executado no banco, fora de `supabase/migrations`.**
- `integration/README.md`: contratos e bloqueios de integração.
- `tests/menu-integration-contract.test.cjs`: testes locais de aceite.

## Testes executados nesta etapa

`node --test` nos testes originais locais mais os novos: 93/93 PASS (56 + 37). Sem falhas. Teste com banco PostgreSQL/RLS real: **não executado**. Não alegar segurança multiempresa comprovada só com mocks. Regressão completa oficial de `npm test`: **não executada** nesta rodada.

## Regras críticas

1. `active=false` é uma restrição de banco na intenção de publicação: nenhum caminho de ativação de TV, playlist, campanha, gateway ou player foi criado.
2. Modos `menu_only` e `interleave` resultam somente em `review_required`.
3. Escrita da proposta SQL exige papel autorizado conferido no backend e empresa ativa; leitura prevista com RLS por empresa.
4. Revisão imutável; repetição idempotente do mesmo pedido; atualização concorrente requer `expected_revision`.
5. Logo e vídeo só devem usar `media_assets` da mesma empresa e com armazenamento privado.

## Trabalho restante até uso real (sem reiniciar o projeto)

**Gate B — homologação integrada:** autorizar explicitamente testes em PostgreSQL/Supabase isolado e implantação de Edge Functions apenas em staging; corrigir o que os testes reais comprovarem; ligar painel e player de homologação sob feature flag, política de anúncios/playlist sem atropelos, vídeo persistente durante edição e cache offline. Testar regressão completa. SQL-01/SQL-02 seguem bloqueados.

**Gate C — piloto físico e liberação:** TV autorizada, critérios de offline/reconexão/reinício, evidências e autorização explícita de produção. Nenhuma alteração automática em player oficial, APK, deploy, merge, migrations, Edge Functions ou produção.

**Bloqueador:** a proposta SQL deve ser revisada/validada contra o esquema efetivo em um banco descartável antes de qualquer aplicação. O arquivo é um ponto de partida, não uma migration aprovada.
