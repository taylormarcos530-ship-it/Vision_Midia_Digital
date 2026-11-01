# Vision V2 — Arquivo externo criptografado, CQRS, runner independente, SHA-256 e paridade RPC

**Data:** 31/10/2026–01/11/2026, horário de execução UTC. **Branch isolada:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Veredito:** PASS nos dois jobs GitHub Actions de QA PostgreSQL17 independente, **GO apenas para continuar experimentos** e **NO-GO para produção, retenção com DELETE, novo APK ou migração**.

## Evidência verificável

- [GitHub Actions run 41255802994](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41255802994), commit efetivamente testado `7fcad4b06bbe1267f7d1a443b08859d973861346`. Dois jobs independentes concluídos com `success`:
  - Runner A: `Runner A - PG17 originals, AES256GCM encrypted segments, SHA256, JSON reference`.
  - Runner B: `Runner B - independent PG17 restore, corruption/outage, full JSON and export`.
- [Workflow](../../.github/workflows/vision-v2-independent-cqrs-archive-qa.yml) e [script Python integral](../../tests/vision-v2-sequence-qa/independent-cqrs-archive-qa/pipeline.py), ambos executados exclusivamente no CI da branch.
- [Primeiro run 41255699774](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41255699774) com **Runner A PASS, Runner B FAIL** por erro do código de comparação `NameError: name 'date' is not defined`, após restaurar dados. [Correção isolada `7fcad4b06bbe...`](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/commit/7fcad4b06bbe1267f7d1a443b08859d973861346) importa `date`. [Segundo run 41255802994](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41255802994) **2/2 PASS**. Esse histórico de FAIL de QA não foi omitido e não se refere à produção.
- Os RPCs originais `get_playback_report` e `get_playback_events` são lidos e executados em PG17 local da migração versionada no GitHub: `supabase/migrations/20260908025620_add_playback_report_rpc.sql` e `supabase/migrations/20260908025854_add_playback_export_rpc.sql`. Nenhuma chamada ao Supabase oficial.

## Arquitetura efetivamente testada

1. **Runner A, PostgreSQL17 descartável:** gera duas empresas, 664 eventos comerciais sintéticos, dimensões, nomes históricos, 2 comprovantes sem horário e read model CQRS. Projetor com rollback injetado e restaurado, baseado na suíte validada de RPC exato. **664/664 originais preservados** em `public.playback_logs`.
2. Exporta as oito tabelas sintéticas necessárias às dependências do relatório e distribui seus registros em **13 segmentos**, cada um com no máximo 120 linhas.
3. Cada segmento: identidade autenticada por AES-256-GCM com nonce aleatório, metadados de tabela/faixa/colunas como AAD, SHA-256 **do arquivo criptografado** e **do payload em claro** no manifesto, contagem e tamanho. Objetos são escritos fora do banco PostgreSQL e publicados como artefato GitHub Actions.
4. Uma chave AES de **32 bytes gerada exclusivamente para o teste** é enviada por um **segundo artefato GitHub separado**, com retenção de 1 dia e sem impressão nos logs. **Esse transporte NÃO é gerenciador seguro de chaves nem uma solução de confidencialidade de produção.** Qualquer pessoa autorizada a baixar os artefatos do workflow pode conseguir a chave e decifrar os eventos sintéticos. Em produção seria indispensável KMS/gestão segura da chave, restrições de acesso e política de rotação.
5. **Runner B** começa em máquina/contêiner PostgreSQL17 distintos. Faz download dos dois artefatos, verifica hashes, autenticação GCM, sequenciamento dos segmentos e quantidade, e **só depois** grava as linhas em uma nova base. O ACK de arquivo é gravado após a verificação completa e o commit de restauração.
6. Antes da restauração, injeta casos negativos: objeto ausente, ciphertext adulterado, truncado, chave errada. Todos são **rejeitados**, sem confirmação indevida. O objeto original é recolocado e a recuperação passa. Nova leitura integral e repetição do ACK com `ON CONFLICT DO NOTHING` mantêm **uma confirmação**, sem novos dados.
7. A projeção CQRS é reconstruída na base nova. Os RPCs comerciais originais são executados em seu ambiente sintético PostgreSQL e comparados tanto com a projeção reconstruída quanto com a **referência original obtida no Runner A**, em JSON canônico.

## PASS/FAIL — dados extraídos dos logs da execução final

| Indicador | Resultado |
|---|---|
| Runner A / Runner B | **PASS / PASS** |
| Registros originais no runner de origem | **664**, não excluídos |
| Registros restaurados no runner independente | **664** |
| Segmentos cifrados | **13** |
| Soma dos arquivos de segmentos cifrados | **351.680 bytes** |
| Soma dos segmentos antes da cifragem/envelope | **262.641 bytes** |
| SHA-256 do cipher e payload conferidos por segmento | **PASS** |
| AEAD (AES-256-GCM) com AAD por descriptor | **PASS** |
| Arquivo indisponível | **rejeitado; recuperado após retorno** |
| Cipher adulterado, arquivo truncado | **rejeitados** |
| Chave incorreta | **rejeitada** |
| ACK de segmento/arquivo após verificação | **PASS**, uma linha |
| Retry idempotente da confirmação | **PASS**, sem duplicata |
| JSON completo de relatório original = referência = CQRS restaurado | **48/48 PASS** |
| Exportação de eventos original = referência = CQRS restaurado | **48/48 PASS** |
| Linhas de resumo diário reconstruído | Fonte sintética agregada, sem substituir os 664 eventos |
| Eliminação de originais | **Nenhuma** |
| Supabase, APK, painel, site ou TVs | **Não tocados** |

### Volume, índice e latência

| Métrica | Runner A (banco fonte e projeção) | Runner B (banco restaurado) |
|---|---:|---:|
| `pg_database_size` | **10.049.203 bytes** | **9.352.883 bytes** |
| `public.playback_logs` — tabela com índices | 524.288 bytes | 524.288 bytes |
| `public.playback_logs` — só índices | 335.872 bytes | 335.872 bytes |
| `qa_rpc.read_events` — tabela com índices | 720.896 bytes | 524.288 bytes |
| `qa_rpc.read_events` — só índices | 376.832 bytes | 335.872 bytes |
| `qa_rpc.daily` — com índices | 114.688 bytes | 114.688 bytes |
| `qa_rpc.daily` — só índices | 16.384 bytes | 16.384 bytes |

**Não são medições antes/depois da mesma estrutura.** Runner A ainda contém `qa_rpc.restored_events`, incluída pelo teste de rollback/restore da suíte original, além de maior overhead de indexação em seu read model. Runner B não cria essa terceira cópia antes da restauração. O tamanho do banco pode diferir por metadados, índice, otimização e execução. **A diferença de tamanho NÃO comprova economia da compactação.** Os dois bancos têm **664 originais + outra cópia detalhada de 664 eventos**, portanto não demonstram redução líquida de armazenamento em operação.

| Latência da consulta de relatório (48 casos, runner B) | RPC sobre histórico original | RPC sobre read model CQRS |
|---|---:|---:|
| Mediana observada | 5,364 ms | 4,909 ms |
| P95 observado | 12,110 ms | 11,644 ms |

Há uma pequena vantagem de latência na amostra de bancada, **não um ganho estatisticamente demonstrado**, nem SLA com 100/300 TVs, nem redução de rede/índices Supabase. Os 351.680 bytes cifrados **também ocupam armazenamento externo adicional**; o baseline JSON e o artefato da chave não estão incluídos nessa soma.

## Riscos importantes, sem encobrir

- **CQRS diário compacto não permite, sozinho, reconstruir o JSON e a exportação original.** A compatibilidade demonstrada exige eventos detalhados no read model ou restauração sob demanda de arquivo durável autenticado. O teste manteve bruto e read model completos; não substituiu 664 eventos por uma única linha diária.
- **Cópia externa independente em CI** significa artefato GitHub Actions transferido entre jobs em runners distintos; **não** demonstra bucket S3/Storage durável, política de replicação de longo prazo, queda física do provedor, teste entre contas, chave gerida por KMS ou restore de arquivo de meses.
- O teste **não apaga originais**. A falha de objeto foi injetada antes do início da restauração, o que comprova fechamento seguro naquele momento; não substitui simulação de falha a meio de uma transação de múltiplos segmentos, de energia, nem de banco comprometido.
- **ACK seguro de arquivo** é separado do protocolo de **ACK por reprodução da TV**. Foi validada a confirmação única do manifesto/restore, não foi executado o gateway Android/HTTP de produção.
- A segurança RLS deste ensaio é o scaffold **sintético já validado anteriormente**; não afirma que as políticas implantadas no Supabase oficial estejam iguais.
- O hash por segmento e AEAD protegem a autenticidade criptográfica sob chave de teste, mas **não** substituem controle de autorização de acesso, trilha assinada de manifestações e rotação de chaves em produção.

## Decisão técnica

**PASS:** prova de conceito de arquivo por segmento, criptografia, detecção de adulteração, runner independente, recuperação após indisponibilidade, replay idempotente, ACK de arquivo e **paridade de 48 relatórios completos e 48 exportações** com RPC original do GitHub no PostgreSQL17 descartável.

**GO somente para próximos experimentos isolados. NO-GO para produção**, alterações no Supabase/APK, ativação de retenção/DELETE ou remoção de índices. Para economia real, próximo passo é testar arquitetura de **read model compacto sem cópia integral** + consulta sob demanda ao arquivo externo criptografado, preservando o contrato original do RPC, incluindo exportação, snapshots, filtros, segurança e recuperação. Medir bytes **totais** (banco, índices, objetos cifrados, manifesto e backups), latências em cache frio/quente e custo de requisições; não eliminar dados originais até autorização específica e testes de restore end-to-end.
