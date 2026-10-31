# Vision V2 — Decisão técnica sobre histórico, sequência e compactação
**Data:** 31/10/2026 · **Status: PROPOSTA DE HOMOLOGAÇÃO, NÃO IMPLANTAR**  
**Alvo:** somente `feature/vision-v2-isolated-foundation-20261031`.  
**Proteção:** não alterar projeto Supabase antigo, `main`, TVs, APK ou site oficial; não executar `DELETE` nem `TRUNCATE` em dados de cliente.

## 1. Problema comprovado no legado e na F1 atual

- Leitura do Supabase V1: `playback_logs` ~210.582 linhas estimadas; ~53 MB de heap e ~140 MB de índices, ~193 MB total, 12 índices. Estatísticas de linhas são estimativas, e índices não devem ser removidos sem `EXPLAIN` e auditoria de relatórios.
- A V2 F1 atualmente usa `vision_v2_qa.playback_event_keys` (uma identidade SHA-256 por evento) e `playback_recent` (um recibo por evento). **A F1 ainda cresce sem limite**; não há retenção, compactação ou mecanismo de backup homologado.
- Lote de 50 eventos diminui o número de HTTP requests, mas não elimina as 50 linhas/eventos e manutenção de índices. A redução de invocações não prova redução de IO, WAL ou espaço.
- Os relatórios são comerciais: jamais aceitar deduplicação que simplesmente some ou adicione reproduções sem conciliação.

## 2. Alternativas

| Arquitetura | Vantagens | Limitações e riscos | Decisão |
| --- | --- | --- | --- |
| **A. Recibos individuais permanentes** (atual V1/F1) | Auditoria simples por evento, deduplicação estável com identificador único | Crescimento ilimitado em linhas/índices/WAL e custo alto para 50–100 TVs | **Não recomendado** como base definitiva |
| **B. Resumo diário + recibos recentes + ledger de chaves segmentado** | Preserva prova recente e relatórios, compatível com player existente, migração incremental | Ledger cresce se for eterno; segmentação por bytea pode reescrever blobs grandes. Precisa backup/retention/checkpoints e testes de `EXPLAIN` | **Caminho inicial de homologação**, sem deleção até provar reconciliação |
| **C. Sequência monotônica por TV + epoch + watermark durável + janela limitada de hashes + resumo diário** | Estado deduplicador pode ficar limitado por TV, mesmo com milhões de reproduções; identifica lacunas e duplicações; reduz buscas por ID permanente | Requer novo contrato de player e servidor, ACK autenticado e persistido; sequência perdida por corrupção/reinstalação pode causar duplicação; reenvios anteriores à janela **não podem ser confirmados como idênticos** sem comprovante adicional; não foi testada no Postgres real | **Modelo preferido para protótipo F2 isolado**, NÃO substituir F1 ainda |
| **D. Agregação diretamente na TV, sem recibos por evento no servidor** | Menos ingestões e linhas | Fraude/perda de prova em falta de energia, divergência de relógio e períodos offline; difícil provar anúncios por mídia/dia | **Não adotar isoladamente** para relatórios comerciais |

**Recomendação:** preparar a C em ambiente descartável, mantendo B como rede de segurança durante a transição; exigir recibos verificáveis e um fluxo de reconciliação para períodos antigos. Não basta declarar “apaga o histórico em 7 dias”: apagar só pode ser permitido depois de **checkpoint firmado, conciliação, cópia restaurável e cobertura de replays tardios**.

## 3. Contrato que deve ser implementado antes de ativar a C

1. Uma TV pertence a uma empresa validada por credencial individual e possui **epoch** definido/provisionado pelo servidor. Reinício do Android não cria epoch novo, não zera a sequência e não perde a fila.
2. Cada reprodução nova recebe `seq` monotônico **e persistido** junto do evento antes de avançar o player. Reinstalação/reset exige reconciliação e autorização administrativa; tokens antigos precisam ser revogados.
3. O servidor guarda `watermark` de sequência contígua confirmada e uma janela de eventos pendentes fora de ordem, com hashes recentes para confrontar reenvios conflituosos. A janela tem limites explícitos de tamanho, idade e quota.
4. Lotes de no máximo 50 são uma transação: validar todos, avançar sequências, atualizar resumo e persistir checkpoint **atomicamente**. Falha reverte tudo; ACK só depois do commit.
5. O ACK precisa trazer `device_id`, `epoch`, `committed_through`, identificação de versão e prova adequada ao canal autenticado. O cliente rejeita ACK de outro dispositivo/epoch, do futuro, regressivo ou maior que a sequência emitida; só remove comprovantes já confirmados.
6. Se a rede falhar ou a confirmação se perder depois do commit, o mesmo lote deve ser reenviado. Reenvio idêntico dentro da janela resulta em duplicata reconhecida, **não** em nova reprodução.
7. **Reenvio antigo fora da janela:** responder `reconciliation_required`, preservando a fila original e o arquivo de prova. Nunca responder “duplicado” sem evidência. Reconciliar usando checkpoint assinado/arquivado ou análise assistida.
8. Contadores por dia devem usar fuso da empresa, nome da mídia, campanha, TV, início/conclusão, duração. Eventos atrasados corrigem o dia original, sem contar duas vezes.
9. Queda de energia, `localStorage` corrompido ou sem espaço: falhar de maneira recuperável; não sobrescrever comprovantes. A V30 já demonstrou que armazenamento físico esgotado continua bloqueador para garantia de novos eventos.
10. Nenhuma TV deve consultar a cada poucos segundos por padrão. Preferir manifesto versionado, consulta adaptativa, jitter, backoff e comando via push com fallback. Uma sincronização sem mudança deve **ler** e responder pequena, sem atualizar linhas.
11. Acompanhamento obrigatório de invocações Edge, egress, tamanho do heap/índices, WAL, CPU/I/O, gravações por reprodução, p95/p99 de API e discrepâncias de contagem.
12. Não criar mais índices por precaução. Medir com `EXPLAIN (ANALYZE,BUFFERS)` e `pg_stat_user_indexes`; preservar índices de unicidade, empresa e relatórios realmente usados.

## 4. Evidências já produzidas (reais, mas de SIMULAÇÃO)

- **CI GitHub Actions [41220801069](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41220801069): PASS 30/30, FAIL 0**, sem segredos e sem deploy; commit `790cba1d93bc41408641f49744d8506904443494`.
- Fonte do [modelo de sequência](../../tests/vision-v2-sequence-model.cjs) e [suíte de 30 casos](../../tests/vision-v2-sequence-qa.test.cjs). Casos incluem: perda do ACK, reenvio, lacunas, fora de ordem, reinício persistido, rollback anterior ao commit, empresa A/B, token revogado, epoch distinto, armazenamento local cheio, evento malformado, 10.000 reproduções e ACK futuro forjado.
- **10.000 reproduções no modelo JavaScript**: 10.000 contadas, zero duplicação, janela de 128 hashes recentes por TV. É uso de `Map` em memória fictícia, **não** economia medida no PostgreSQL, não prova concorrência SQL ou desempenho Android.
- **CI [41219582909](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41219582909): PASS 6/6** sobre orçamento teórico de chamadas. Exemplo a cada 5 min e mídia de 15 segundos, 100 TVs/30 dias correspondem a 17.280.000 eventos e cerca de 1.209.600 chamadas (sync + lote de 50). **Estimativa** sem retries, comandos, outra organização ou overhead.
- **CI [41219349476](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41219349476): PASS 16/16** contrato da F1 com mocks.
- Esses casos **não autorizam** afirmar que a arquitetura final já tolera 100 TVs ou que funciona como concorrente específico. Os detalhes internos de terceiros não são públicos.

## 5. F2 — próximos testes para obter PASS de homologação

**F2A — PostgreSQL 17 descartável**, com esquema SQL da C, sem Supabase de produção: concorrência de dois consumidores sobre a mesma TV/epoch, duas empresas, 100k–1M eventos sintéticos, tempestade de retries, fora de ordem, ACK perdido, 7 dias offline e relatórios retroativos. Medir linhas e bytes reais por milhão, WAL gerado, tempo de ingestão, índices e locks. Comparar com arquitetura B na mesma massa. **Não ativar retenção automática.**

**F2B — restauro e prova comercial:** ledger/checkpoints + arquivo de prova criptografado e restaurável; verificar que relatórios diários e por anunciante coincidem antes/depois da compactação, incluindo replays posteriores à retenção. Sem backup restaurado, **FAIL**.

**F2C — API HTTPS e player de QA:** autenticação com token individual e JWT apropriado, contrato do ACK forte, atualização remota por versão, cache offline, reconexão, autorização expirada, instalação/reinício. Nenhum dispositivo de cliente.

**F2D — capacidade:** cargas de 7, 12, 20, 50 e 100 TVs simuladas com 30% de folga nas **quotas do plano e nos recursos efetivos**. Lembrar que a organização Ofertas TV compartilha franquias com outro projeto. Medir concorrência e DB, não apenas Edge invocations.

### Gate atual
- **PASS** modelo lógico de sequência em Node 22, 30/30.
- **PENDENTE / NO-GO** SQL de sequência, concorrência real, tamanho real de índices, durabilidade de arquivos após falta de energia, HTTPS real, Auth/RLS do painel, backup-restauração, dados comerciais e testes com 100 TVs.
- **NÃO MEXER** no Supabase antigo, Vercel oficial, APK ou TVs; nenhuma limpeza automática.
