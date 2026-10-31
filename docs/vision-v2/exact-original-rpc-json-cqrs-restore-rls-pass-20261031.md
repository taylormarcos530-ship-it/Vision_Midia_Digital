# Vision V2 — RPC ORIGINAL PostgreSQL 17, JSON integral, CQRS, RLS, fuso São Paulo, exportação e restauração

**Data:** 31/10/2026. **Branch de QA:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Resultado final:** PASS da execução PG17 descartável. **GO apenas para homologação isolada adicional; NO-GO para deploy/compactação/migração.** Nenhum SQL, consulta ou mudança foi realizado no Supabase oficial.

## Evidência verificável do GitHub Actions

- [Execução definitiva GitHub Actions 41254292111](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41254292111), **conclusion=success**, commit do código testado `4f1926fa0cddfa0a8fd826f303e781294b9dd5f5`. Log: `QA_EXACT_RPC_ORIGINAL_CQRS_FULL_JSON_PASS=true`.
- [Primeira execução 41254223049](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41254223049) também **PASS** para igualdade entre RPC original e projeção. A segunda execução acrescentou **comparação dos RPCs sobre uma tabela restaurada a partir de arquivo serializado**, não só igualdade de linhas.
- [Script final](../../tests/vision-v2-sequence-qa/exact-rpc-qa/verify.py), [schema mínimo de QA](../../tests/vision-v2-sequence-qa/exact-rpc-qa/scaffold.sql), [workflow NO DEPLOY](../../.github/workflows/vision-v2-exact-rpc-qa.yml).
- SQL de referência original, **executado literalmente sem modificação**: [get_playback_report](../../supabase/migrations/20260908025620_add_playback_report_rpc.sql) (SHA-256 `6f786aa03035ec00fc690330600ef69df936ebc9b306dec8d5637e4f856a5ea7`) e [get_playback_events](../../supabase/migrations/20260908025854_add_playback_export_rpc.sql) (SHA-256 `343da1c2ec7f4c6bf97844e847ecf8178dc9e4eb763b90071a8fe115cdcc4edc`).
- As variantes `get_playback_report_cqrs` e `get_playback_events_cqrs` são criadas no CI trocando **somente o nome da função e o nome da tabela de origem** para `qa_rpc.read_events`; não alteram os filtros/agrupamentos/regras de JSON da função de origem. A verificação adicional cria uma terceira variante consultando `qa_rpc.restored_events`, reconstruída a partir de bytes serializados.
- **Infra:** PostgreSQL 17 Alpine descartável em serviço do GitHub Actions; Python 3.12 + psycopg 3.2.6; dados inteiramente sintéticos, sessão `SET LOCAL ROLE authenticated` com RLS por claim. Não é um Supabase em execução com serviços Auth/Realtime/Storage reais; não há SDK Supabase nem chaves de produção.

## Paridade íntegra do JSON comercial

Os dados sintéticos representam **2 empresas × 332 reproduções = 664 eventos**, com IDs UUID, **3 TVs, 3 campanhas e 4 mídias por empresa**, playlists, nomes históricos, alterações nas tabelas de dimensões, nomes de snapshot em branco com fallback e nulos (campanha, playlist e mídia). Datas locais simuladas de **30/10, 31/10 e 01/11/2026**, com os minutos ao redor da meia-noite e UTC vs `America/Sao_Paulo`.

O RPC original foi chamado com a role autenticada, JWT sintético HS256 validado antes de definir claims, filtro de empresa, seis janelas de data, quatro combinações de filtros por campanha e TV, paginação de exportação (limites 12, 500, 9999, -9; offsets 0, 12, -1) e limites de data inválidos.

| Prova concreta (run 41254292111) | Resultado |
|---|---|
| Funções originais instaladas inalteradas em QA | 2, PASS |
| Variantes CQRS de leitura derivadas | 2, PASS |
| Comparações de JSON COMPLETO `original == CQRS == restaurado` | **48 PASS** |
| Comparações de exportação paginada `original == CQRS == restaurado` | **12 PASS** |
| Eventos nos JSONs analisados quanto ao dia local correto | **4.362** |
| Limite de eventos recentes dentro do relatório original | **250, PASS** |
| Nomes históricos e nomes atuais após renomeação das entidades | PASS |
| IDs nulos e textos fallback | PASS |
| Divergência na composição JSON (summary, campaigns, devices, media, events) | **0 nos 48 cenários** |
| Registros de fonte comercial preservados | **664/664** |
| Linhas de resumo diário agregadas | **276** |
| Comprovantes sem horário mantidos fora da contabilização comercial | **2/2** |
| Total de TVs distintas do intervalo de uma empresa | **3** |
| Soma incorreta de distintos diários (demonstração) | **8** |
| Consultas de segurança/condições inválidas rejeitadas | **18 PASS**, 0 vazamentos entre empresas |

**Importante:** os 48 testes são de igualdade **com o RPC real do GitHub**, não uma reimplementação livre do formato. A fonte é `public.playback_logs`; a leitura CQRS detalhada vem de `qa_rpc.read_events` materializada; a restauração vem de `qa_rpc.restored_events` carregada de backup independente.

### Limitação inevitável do CQRS diário

A projeção de eventos **mantém uma cópia por evento** e permite reproduzir a lista dos 250 eventos e a exportação individual na íntegra. A tabela de **276 linhas diárias** permite resumir contagens/durações por empresa, TV, campanha, playlist, mídia e nomes; porém **não basta sozinha para produzir o JSON integral**, porque não contém cada evento individual, detalhes de exportação nem necessariamente informações adequadas a `COUNT(DISTINCT)` cruzando dias. Não é correto considerar 276 linhas como substituição de todos os 664 registros, nem como economia líquida de Storage: duplicar bruto + read model aumenta espaço até existir política de retenção confiável.

O teste confirma a armadilha `COUNT(DISTINCT)`: total correto de **3 TVs**, contra **8** ao somar erradamente os distintos dos dias. Para evoluir um CQRS mais compacto, precisa manter sets exatos ou consultar fontes detalhadas com ACL, preservando o JSON comercial.

## RLS e JWT sintéticos — controles aplicados de verdade no PostgreSQL

- `private.is_company_member(p_company_id)`, usada literalmente pelo RPC original, foi recriada somente no PG17 descartável para conferir membership via `request.jwt.claim.sub` e `request.jwt.claim.company_id`, com tabela de membership sintética; **não é a implementação interna de membership do Supabase oficial**.
- Roles `authenticated` e `anon` recriadas no PG17. As tabelas `playback_logs`, `qa_rpc.read_events`, `qa_rpc.restored_events`, `qa_rpc.daily` e os catálogos de dimensões tiveram RLS ativada, com leitura filtrada por claim de empresa.
- Chave HMAC gerada em memória no runner, jamais salva ou impressa. JWT sintético de empresa diferente, vencido ou adulterado rejeitado; usuário autenticado não viu linhas brutas, read model ou CQRS de outra empresa. O próprio RPC original bloqueou report e exportação de empresa diferente. A role `anon` não pôde executar a função.
- Total verificado: **18 casos negativos PASS**, sem vazamento visível nos cenários de teste. Ainda faltam claims reais do Supabase Auth, permissões `service_role` e RLS real de banco Supabase em ambiente de homologação; esses resultados **não certificam a configuração produtiva**.

## Rollback, backup, SHA-256 e restauração

1. Criado em PG17 um trigger de falha no INSERT da projeção diária e executada uma transação com read model, daily e cursor. O PostgreSQL fez rollback: **0 linhas na projeção, 0 na daily, cursor 0**; os **664 eventos de origem permaneceram intactos**.
2. Removido apenas o trigger da suíte QA, o projetor preencheu **664 eventos no read model** e **276 agregados**, cursor persistido na mesma transação.
3. Exportada a projeção como bytes JSONL para arquivo em diretório temporário separado. Criado manifesto SHA-256 e contagem de linhas. Uma variante artificialmente adulterada gerou hash diferente do manifesto; a cópia original foi validada pelo SHA.
4. Um **novo** conjunto `qa_rpc.restored_events` foi recriado **a partir dos bytes do arquivo** (sem `INSERT SELECT` da tabela de origem na etapa de restauração), com 664 linhas. Comparados IDs/campos/origem/restauração. **Nenhum original deletado.**
5. A tabela restaurada recebeu RLS própria por empresa e foram criados RPCs derivados sobre ela. Os **48 relatórios completos e as 12 consultas de exportação** coincidiram com o RPC original e com o CQRS não restaurado.
6. Trata-se de **arquivo temporário local JSONL + SHA-256**. O teste **não demonstrou armazenamento externo durável criptografado, restore após perda da base de origem ou recuperação entre runners**. Esses controles exigem integração de uma suíte externa separada já planejada antes de qualquer retenção com exclusão.

## GO/NO-GO

**GO — somente QA isolado:** avançar estudos de armazenamento e paridade comercial, autenticação e restore em ambiente Supabase local descartável, observando indicadores de tamanho, latência, segurança e custos.

**NO-GO — produção:** não executar migrations, `DELETE`, `DROP INDEX`, compactação da V30, substituição dos RPCs, mudanças de RLS, deploy Vercel/Supabase, APK ou atualização de TVs. Este ensaio não comprova redução de índices, tráfego das TVs, WAL no Supabase real, nem equivalência de toda a lógica de autenticação das contas.

**Próximo gate recomendado:** testar a projeção CQRS usando somente os agregados onde houver paridade comprovada, mantendo eventos recentes/exportação sob armazenamento durável; testar migração/restore de backup **criptografado em outro runner**, paridade de JSON após indisponibilidade de arquivo e autorização realista em Supabase local, sem tocar produção.
