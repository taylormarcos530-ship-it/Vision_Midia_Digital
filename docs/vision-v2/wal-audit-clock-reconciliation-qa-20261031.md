# Vision V2 — WAL, limites da auditoria e reconciliação de relógio (31/10/2026)

**Resultado final:** 62 PASS, 0 FAIL, 0 erros, 0 ignorados nos testes Android/Robolectric com SQLite nativo; **NO-GO para produção**. Sem Supabase, APK ou TV real.

## Evidência da execução

- Branch: `experiment/vision-v2-sequence-watermark-qa-20261031`.
- [GitHub Actions 41226990503](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41226990503), commit verificado `f102bc235eb0b7df72d54cdca57f49eb5317c124`.
- Log: `BUILD SUCCESSFUL in 56s`, `ANDROID_SQLITE_ROBOLECTRIC=PASS`.
- XML: 5 testes novos (`WalAndAuditBudgetTest`) + 57 regressões de 5 classes = **62 PASS**, zero falhas e erros.
- Código alterado somente em `tests/vision-v2-sequence-qa/android-sqlite-qa/`:
  - [SegmentedOfflineQueue.java](../../tests/vision-v2-sequence-qa/android-sqlite-qa/src/main/java/br/com/visionmidia/v2qa/SegmentedOfflineQueue.java)
  - [WalAndAuditBudgetTest.java](../../tests/vision-v2-sequence-qa/android-sqlite-qa/src/test/java/br/com/visionmidia/v2qa/WalAndAuditBudgetTest.java)
- Sem comandos de deploy, credenciais reais, publicação ou instalação. O workflow faz checkout somente leitura e testes com Node/Gradle/SQLite em runner descartável.

## Carga de uma TV — 7 dias offline a uma reprodução a cada 15s

| Métrica real do run | Valor |
|---|---:|
| Eventos persistidos e recuperados após reabertura | 40.320 |
| Peak observado de arquivo `-wal` ao longo dos lotes | 346.112 bytes |
| Checkpoints executados no loop | 19 |
| `-wal` antes de reabrir | 259.592 bytes |
| `-wal` depois de reabrir | 0 bytes |
| Arquivo principal depois de reabrir | 3.989.504 bytes |
| `-shm` após reabertura | 32.768 bytes |

**Atenção:** o cálculo de `page_count × page_size` não equivale à ocupação simultânea do DB+WAL+SHM; medir os três separadamente. O checkpoint usa `PRAGMA wal_checkpoint(TRUNCATE)` **fora da transação** quando o WAL observado supera 256 KiB. Se o resultado indicar leitor bloqueando checkpoint ou tamanho acima da margem, o método recusa a próxima operação com `wal_backpressure_retry_later`, preservando registros existentes. O pico medido ficou abaixo do limite de backpressure de 2 MiB durante o ensaio, mas **não há prova de teto rígido de disco em produção**, porque a própria transação gera WAL, outros escritores podem atuar e o disco pode ficar sem espaço mesmo abaixo do limite.

## Quotas de auditoria — testes executados

- `MAX_AUDIT_PROOFS = 4096`, `MAX_AUDIT_REVIEWS = 8192`; `AUDIT_STAGE_BATCH = 128`.
- Foram inseridos **5.000 comprovantes pendentes**, dos quais **4.096** foram registrados em auditoria em 32 chamadas (4.096 provas e 4.096 revisões). Na cota, `stageUnresolved` rejeitou nova entrada com `audit_capacity_export_required`; todos os 5.000 eventos originais, sem horário confirmado, permaneceram guardados. Tabelas de auditoria + fila: tamanho lógico de páginas **1.187.840 bytes** no cenário.
- Outro ensaio gerou 8.192 revisões de teste e verificou rejeição da revisão 8.193; prova original e evento permaneceram intactos. Tamanho lógico de páginas neste cenário: **245.760 bytes**.
- Um erro SQL injetado no segundo registro da auditoria reverteu **toda a operação de staging**, sem apagar os três comprovantes pendentes. Reabrir e tentar novamente funcionou.
- Comprovantes de um boot anterior sem âncora confiável permaneceram sem data e sem ACK mesmo após revisão manual e reinicialização.
- O mecanismo de cota evita crescimento ilimitado dos registros de auditoria **somente pelo caminho testado**. Depois de alcançar 4.096 provas, a auditoria deixa de aceitar novas provas até existir exportação com confirmação segura; **isso NÃO significa que todos os 40.320 eventos da semana foram auditados**.
- Arquivos WAL/SHM, outros usuários de SQLite e mídia não são regidos pela cota de provas. A aplicação deve monitorar espaço físico disponível, reservar margem e enviar alerta antes de exaustão.

## Conciliação segura dos comprovantes sem horário — PROPOSTA, NÃO IMPLEMENTADA

O problema fundamental é que uma TV Box pode iniciar com relógio 1970 e reiniciar antes de receber um horário confiável. O evento tem identidade e ordem monotônica local, mas não possui data verificável. Nenhum algoritmo consegue recuperar a hora real do boot antigo somente com a hora recebida no boot novo.

**Estados propostos:**
1. `PENDING_TIME`: comprovante original, identidade do stream, sequência, ID, mídia, monotonicidade, boot e hash local; proibido inventar dia.
2. `SAME_BOOT_ANCHORED`: hora de servidor autenticada para **o mesmo identificador de boot**; reconstruir timestamp pela monotonicidade, validar tolerância, preservar original e registrar evidência.
3. `PRIOR_BOOT_UNVERIFIABLE`: boot antigo sem âncora; manter data NULL; não contabilizar em dia/faturamento, não descartar, e bloquear envio convencional que pressupõe timestamp.
4. `QUARANTINED_SERVER_ACK` (**futuro**, somente após criar endpoint de QA): enviar evento sem hora em envelope autenticado com motivo e sequência original; servidor deve deduplicar, armazenar prova de recebimento imutável, **não criar faturamento datado** e devolver ACK autenticado **do mesmo stream**. Este mecanismo permite destravar eventos seguintes sem pular números, mas **ainda não está implementado nem testado**, e pode elevar o armazenamento.
5. `RECONCILED_WITH_EVIDENCE`: somente se surgir evidência temporal confiável independente; vincular decisão e assinatura/autorização, preservar antes/depois. Revisão manual sem evidência não é autorização para atribuir horário.
6. `ARCHIVED_VERIFIED`: só depois de backup externo criptografado, manifesto/hashes por segmento, verificação/restauração amostral (idealmente total) e ACK externo confirmando transferência. **Não apagar prova nem autorizar compactação na implementação atual.**

**Invariantes necessários no backend futuro:** 
- Uma TV só pode confirmar a própria sequência e stream; isolamento entre empresas e troca de stream rigorosos.
- Um único contador contínuo de recebimento não pode avançar sem guardar integralmente a prova de cada evento inédito; confirmado não equivale a faturado. Eventos datados entram em resumo comercial; quarentenados ficam em relatório à parte.
- Prova ausente não pode transformar evento em duplicata ou sumir do histórico. Perda de ACK permite reenvio idempotente.
- As operações de confirmação, armazenamento de quarentena e atualização do watermark precisam fazer parte da **mesma transação PostgreSQL**. Não emitir ACK antes do commit.
- Registro de auditoria deve distinguir `hora verificada` de `hora estimada`; a segunda nunca pode ser usada como fato comercial sem regra explícita e aprovação.
- Se o dispositivo encher o disco, não prometer contagem de exibições que não foram efetivamente registradas. Uma medida segura é pausar/limitar a agenda comercial auditada e mostrar alerta; não substituir a fila nem apagar provas.

## Gates que ainda impedem uso real

**Não homologado:** checkpoint com leitor concorrente bloqueando WAL; corte físico da alimentação e desgaste eMMC; SQLite em TV Box Aquário/Smart Pro 3000; limite físico do volume enquanto `-wal` está aberto; emissão/autenticação real de âncora, stream e ACK; backup externo criptografado com prova de restauração; exportação de auditoria; retenção pós-ACK; gateway QA multiempresa; volume de Storage, requisições e custos no Supabase V2.

**PASS do laboratório NÃO implica que a Vision pode operar 7 dias offline sem restrições.** O banco armazena os eventos da semana, mas a contagem comercial pode ficar bloqueada caso não haja referência temporal confiável. A fila ainda tem teto de 50.000 eventos e a auditoria de 4.096 provas.

**Proteção operacional:** nenhuma alteração em Supabase legado ou novo, site, painel, API online, APK ou TVs; experimentos restritos à branch. Não fazer deploy ou conectar equipamento sem autorização posterior específica.
