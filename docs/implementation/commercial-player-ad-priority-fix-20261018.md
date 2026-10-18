# Vision Mídia Digital — proteção da ordem do anúncio no Player oficial (código isolado)

## Falha confirmada no código candidato (sem tocar no player de produção)

Ao receber uma atualização do manifesto com a mesma playlist de estabelecimento, `player.js` escolhia a primeira mídia nova para execução prioritária. Uma revisão comercial recém-intercalada aparecia como mídia nova, podendo ser deslocada do item 4 ou 8 para o primeiro item da próxima rodada, contrariando a regra de não substituir/interromper a programação do cliente.

## Ajuste

- O gateway candidato marca anúncios com `commercial:true` no item do manifesto.
- `player.js` usa `findNewPointMediaPriority` para desconsiderar esses itens comerciais na priorização, preservando o comportamento atual para mídias realmente novas do estabelecimento.
- Não modifica playlist, IDs de mídia, cache, autenticação ou telemetria; não liga a feature flag de publicidade.
- Testes usam função extraída do Player verdadeiro, verificando anúncios em 4/8, mudança de revisão, mídias normais prioritárias e reconexão.

## Estado/limites

A distribuição virtual e Storage em homologação foram aprovados; isto é apenas a proteção de **posição dos anúncios** para o código futuro. O gateway comercial e as tabelas SQL **não foram ativados em produção**; o dispositivo Life fundo continua com as mídias originais.

**Próximas condições de liberação:** rotação comercial equitativa entre campanhas (players reais ainda não enviam contador de rodada), mídia aprovada/controlada pelo Master, staging funcional equivalente ao gateway operacional, validação do piloto na TV Box e autorização explícita de publicação. Não promover toda a branch.
