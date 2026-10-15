# Vision Mídia Digital — checkpoint de auditoria cronológica das evidências

**Checkpoint de origem:** `f9f0babb7b118be4732ef28016e8be6e7efcdd40`  
**Branch isolada:** `fix/advertiser-portal-safety-20261013`  
**Resultado:** rotina e CLI de auditoria **100% offline**; nenhum staging, API, bucket, banco, player, APK, playlist, gateway ou deploy acessado/modificado.

## O que foi implementado

- `tests/fixtures/commercial-evidence-history.cjs` compara 1–30 **snapshots completos** de formulário, validados pelo contrato anterior. Cada snapshot carrega `sequence` crescente, `recordedAt` UTC canônico e `form` redigido; alterações inesperadas na estrutura são rejeitadas antes da comparação.
- Exige sequência sem saltos, identifica relógio de registro regressivo e observações posteriores à rodada, além de reexaminar todas as referências e critérios a cada snapshot.
- **Alertas gerados:** `REFERENCE_DIGEST_CHANGED`, `REFERENCE_REBOUND`, `EVIDENCE_TIMESTAMP_REWRITTEN`, `EVIDENCE_SOURCE_PROMOTED_OR_CHANGED`, `DIGEST_REUSED_UNDER_DIFFERENT_REF`, `LAB_HASH_RELABELED_STAGING`, `EVIDENCE_REFERENCE_REMOVED`, `STATUS_REGRESSION_REVIEW`, `BLOCKED_STATUS_ELEVATION_UNVERIFIED`, `NEW_PASS_REQUIRES_INDEPENDENT_REVIEW`, `SNAPSHOT_TIME_NON_MONOTONIC`, `EVIDENCE_OBSERVED_AFTER_SNAPSHOT`.
- `tests/commercial-evidence-history.test.cjs` acrescenta **17 testes** sobre a comparação de snapshots, mutação de hash, reuso de identidade, alegação indevida de staging, eliminação de provas e alteração de status.
- `tests/tools/commercial-evidence-history-report.cjs` é um comando **somente leitura** e sem argumentos para produzir um relatório de duas rodadas **sintéticas já presentes no repositório**: modelo vazio e modelo com uma referência LAB.
- `tests/commercial-evidence-history-cli.test.cjs` acrescenta **3 testes** da saída resumida, garantia de ausência de digests na tela e proteção contra leitura de arquivos externos.
- O programa relata apenas rodada, data UTC, referência opaca quando relacionada a um alerta e código de revisão. Ele **não publica SHA completo**, corpo das evidências, URLs assinadas nem credenciais.

## Resultado verificado no GitHub Actions

- **485/485 PASS, 0 falhas**, guard de alterações em arquivos operacionais PASS: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38738172529
- Uma execução preliminar encontrou somente um teste que exigia um identificador mesmo quando **não havia alertas**. A expectativa foi corrigida para a contagem redigida, preservando a rotina original. A repetição completa terminou em SUCCESS.

Para reproduzir em um checkout autorizado da branch, exclusivamente com modelos fictícios:

```bash
node tests/tools/commercial-evidence-history-report.cjs
npm test
```

## Limites importantes — não confundir relatório com validação do ambiente

Este mecanismo detecta inconsistências **entre os snapshots que lhe forem fornecidos**, mas não possui armazenamento append-only, assinatura digital, testemunha independente ou carimbo de tempo de uma autoridade. Um ator que conseguir reescrever **todo** o histórico poderá criar uma sequência internamente consistente. Além disso, a revisão de horas, origem LAB/STAGING e status declarados **não comprova** a proveniência real dos arquivos.

Mesmo uma sequência sem alertas não certifica a existência, segurança ou autorização de um staging. A ferramenta retorna `stagingOriginVerified:false`, `canConnectStaging:false`, `canRunRealStaging:false` e `canDeployToProduction:false`, independentemente dos valores recebidos. Mudanças de `PASS` para `FAIL` podem ser legítimas, mas continuam exigindo revisão em vez de serem ocultadas.

## Bloqueios e próximo passo

**Staging: 0/17 critérios homologados.** `SQL-01` e `SQL-02` permanecem **BLOCKED**, porque `supabase/sql/advertiser-portal.sql` ainda expõe colunas `source_*` por privilégios de leitura e `to_jsonb(r)`; a proteção revisável só está em `tests/fixtures/commercial-safe-projection-lab.sql`, sem aplicação em bancos reais.

**Próxima etapa sugerida:** acrescentar **cadeia de digests sobre snapshots inteiros** em testes locais, vinculando cada registro ao digest do anterior e demonstrando limites frente à reescrita integral do histórico. Não usar assinaturas reais ou credenciais e **não** conectar ambientes remotos sem autorização separada.

**Preservação permanente:** não alterar player oficial, APK, playlist-base, TVs de clientes, gateway, banco e Storage reais, migrations, Edge Functions, Netlify/Vercel ou produção; não restaurar baseline antigo ou descartar funções existentes.
