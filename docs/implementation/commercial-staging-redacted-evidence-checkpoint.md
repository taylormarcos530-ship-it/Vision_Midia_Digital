# Vision Mídia Digital — checkpoint de inventário redigido de evidências de staging

**Base preservada:** `eb661a40e0315c4ccf2e80421531e33c82982471`  
**Branch:** `fix/advertiser-portal-safety-20261013`  
**Estado:** **BLOQUEADO / NÃO HOMOLOGADO**. Tudo nesta etapa é **documentação, leitura local e testes de contrato**; nenhuma conexão a staging real nem à produção foi realizada.

## O que ficou pronto

1. `docs/implementation/commercial-staging-evidence-template.json`: formulário JSON versionado, com exatamente **17 critérios** `ENV-01` a `ROLLBACK-01`, evidências vazias, 15 estados `NOT_RUN` e duas falhas conhecidas marcadas `BLOCKED` (`SQL-01` e `SQL-02`).
2. `tests/fixtures/commercial-staging-evidence.cjs`: módulo de validação e renderização de **referências opacas**, sem aceitar dados brutos, links HTTP, query strings, tokens ou caminhos de mídia. Exige identificação `EV-XXXXXXXX`, tipo específico do critério, fonte `LAB` ou `STAGING`, SHA-256 hexadecimal com 64 caracteres e data canônica UTC. Todas as propriedades são estritamente limitadas; campos extras são recusados. Não permite o mesmo identificador de evidência em dois lugares.
3. `tests/commercial-staging-evidence.test.cjs`: 17 testes de esquema, origem da prova, bloqueios, campos adicionais com segredos, referências repetidas, datas inválidas e aprovação falsa. Um `PASS` só pode ser representado com ao menos uma referência autodeclarada de `STAGING`, **não com referência LAB**. A validação não certifica que a referência realmente veio de staging.
4. `tests/tools/commercial-staging-evidence-report.cjs`: CLI **somente leitura**, local, que transforma o JSON em Markdown contendo apenas status e IDs opacos. Se o arquivo for inválido, retorna erro genérico; **não imprime a carga rejeitada**. Não acessa rede, não cria deployments e não escreve arquivos.
5. `tests/commercial-staging-evidence-cli.test.cjs`: 5 testes verificam saída legível, leitura explícita do modelo, rejeição de JSON malformado/credenciais, escape de diretórios e ausência de alterações externas.
6. Este relatório do checkpoint.

## Evidência CI

- **Regressão de segurança:** **447/447 PASS, 0 FAIL**; proteção de player/APK/APIs operacionais **PASS**.  
  https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38728082638
- Executados **22 novos testes** para inventário e CLI; os 425 testes anteriores permaneceram verdes.
- **Sem execução de staging real**: as provas demonstram somente que o esquema **rejeita entradas inseguras** e que o relatório não revela os dados da entrada. Não atestam RLS, comportamento Supabase real, identidade de anunciantes nem compatibilidade de TV Box.

## Como usar futuramente, após autorização de um staging segregado

O modelo já pode ser revisado localmente **sem preencher dados de clientes**:

```bash
node tests/tools/commercial-staging-evidence-report.cjs
```

O comando acima gera apenas uma visualização do modelo atual, com os dois itens SQL bloqueados. Para avaliar **um formulário local sintético** ou, futuramente, referências redigidas e revisadas de staging, informar um arquivo JSON local dentro do repositório:

```bash
node tests/tools/commercial-staging-evidence-report.cjs docs/implementation/commercial-staging-evidence-template.json
```

**Exemplo ilustrativo de referência de evidência (não é uma prova real):**

```json
{
  "ref": "EV-00000001",
  "type": "SYNTHETIC_IDENTITY_MATRIX",
  "source": "LAB",
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "observedAt": "2026-10-15T12:00:00Z"
}
```

Use-a apenas no campo `evidence` do requisito correspondente. **Não inventar provas de staging**: os identificadores, hashes e o campo `source` são declarações feitas por quem preenche, não autenticação criptográfica de procedência. O hash precisa ser conferido **fora do formulário**, pelo revisor, contra um artefato realmente produzido e armazenado em destino seguro. O formulário não verifica arquivo de origem, assinatura digital nem acesso remoto. Por desenho, nem um checklist inteiro com `PASS` equivale a autorização para conectar staging ou realizar deploy; `canConnectStaging` e `canDeployToProduction` continuam `false`.

## Regras de coleta e retenção

- Nunca salvar `Authorization`, Bearer/JWT, chave de serviço, URL assinada, pathname original do estabelecimento, dados de clientes, prints de telas reais ou resposta RPC bruta.
- Evidências externas devem permanecer em repositório protegido de auditoria (a definir por responsável autorizado), não em commits públicos. O registro pode guardar apenas referência opaca, classe da evidência, hora UTC, fonte declarada e checksum SHA-256.
- Contas A/B, Master e estabelecimento em staging deverão ser fictícios; nenhum projeto, mídia, playlist ou TV operacional pode ser utilizado.
- Aprovação humana é separada do status do teste. Origem `STAGING` informada pelo usuário **não prova que o dado foi verificado**.
- Verificador bloqueia `status=PASS` sem referência apropriada, mas não implementa acesso real ao Storage, cálculo de hash do arquivo externo nem fluxo de autorização.

## Bloqueios ainda abertos

**0/17 critérios realmente homologados em staging**. `SQL-01` e `SQL-02` continuam **BLOCKED** pelo SQL revisável `supabase/sql/advertiser-portal.sql`: `authenticated` tem acesso a colunas `source_*` e a RPC usa `to_jsonb(r)`. O patch de projeção segura está **somente no laboratório** em `tests/fixtures/commercial-safe-projection-lab.sql`; não foi aplicado em banco real.

Demais 15 verificações continuam `NOT_RUN`, incluindo isolamento A/B real, bucket privado, TTL/cache observados, WebView de teste, custo efetivo, aceite da janela residual e rollback isolado.

## Próximo bloco seguro

Acrescentar **detecção local de alterações indevidas no formulário** e um pequeno demonstrativo de ligação referência→artefato **fictício**, com hashes conferidos em arquivos sintéticos, sem captar dados operacionais. Com isso, uma futura auditoria poderá distinguir **hash declarado** de **hash efetivamente conferido**, sem supor staging homologado. **Nenhuma integração remota, migration, Edge Function ou deploy sem autorização específica.**

**Preservação:** player, APK, playlists, dispositivo, gateway, Storage Supabase, migrations, deploy e projeto de produção permanecem inalterados.
