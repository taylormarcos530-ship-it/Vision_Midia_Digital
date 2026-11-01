# Vision V2 — CQRS compacto, AES-256-GCM sob demanda, JSON integral, cache e custo — PG17 isolado

**Data:** 31/10–01/11/2026. **Branch exclusiva:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Resultado real:** **2/2 GitHub Actions jobs PASS**, no runner descartável PG17. **GO somente para evolução experimental; NO-GO para produção ou exclusão de comprovantes originais.**

## CI e evidências verificadas

- **Run final [41257396715](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41257396715)**, commit do código testado `3051dd0353e8e0585ce36e8e0b95222bfebe3215`, workflow `Vision V2 Compact On-Demand AES Archive 2 Runner PG17 - NO DEPLOY`, **conclusion=success**. Runner A job `124703368617` PASS; Runner B job `124703450813` PASS.
- [Código do teste](../../tests/vision-v2-sequence-qa/compact-ondemand-qa/compact.py) e [workflow QA](../../.github/workflows/vision-v2-compact-ondemand-qa.yml).
- **Run inicial [41257302838](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41257302838): Runner A PASS / Runner B FAIL** porque o conversor QA tentou passar valores de campanha, mídia ou playlist nulos para `uuid.UUID`. Corrigido **apenas** no script de teste no commit `3051dd0353e8e0585ce36e8e0b95222bfebe3215`, conservando todos os `NULL`. Run final 2/2 PASS. Não foi defeito em Supabase/TV.
- **Nenhum SQL enviado ao Supabase de produção**, sem merge, deploy, exclusão, migração, atualização de APK, painel, site ou TVs.

## Arquitetura efetivamente executada

1. **Runner A:** PostgreSQL17 temporário com os **664 eventos comerciais sintéticos originais** (`public.playback_logs`) preservados. Projetou **276 linhas de CQRS diário**; `qa_rpc.read_events`, a segunda tabela permanente de eventos criada pelo scaffold antigo, foi explicitamente removida apenas **do banco descartável**, após remover suas funções derivadas. A aplicação original e seu histórico permaneceram intactos.
2. Criou **10 segmentos externos AES-256-GCM**, separados por empresa e dia de São Paulo, autenticados com AAD por empresa/dia/faixa; manifesto com SHA-256 de ciphertext/plaintext, contagem por segmento, identificador de arquivo e metadados. A baseline de JSON do `get_playback_report` e `get_playback_events` originais foi gravada como artefato de referência sintético.
3. **Runner B**, com outro PostgreSQL17 descartável, recriou os **664 originais sintéticos** e o mesmo CQRS diário (276 linhas), sem segunda tabela permanente de eventos. O objeto cifrado é servido por **HTTP loopback local** dentro do runner, após transporte do artefato GitHub Actions entre jobs distintos.
4. O cliente escolhe segmentos só da empresa/dia solicitados, baixa via **GET HTTP**, valida SHA-256, autentica AES-GCM, preserva `NULL`, e preenche uma **tabela SQL TEMPORÁRIA por conexão**. Os SQLs originais versionados no GitHub foram derivados alterando apenas nome da função e a referência da tabela para `pg_temp.qa_ondemand_events`, de modo que as regras/JSON da consulta permaneçam iguais. O RPC original permanece como referência.
5. Comparação **48 relatórios completos e 48 exportações no modo frio**, seguida de **48 relatórios completos e 48 exportações no modo quente**, além de **48 execuções da referência RPC original** no banco isolado; contagem distinta de TVs permanece correta (**3**), sem misturar dados de outra empresa. Comprovantes sem relógio não foram promovidos à contabilização comercial.
6. Cache quente: apenas no **processo Python do runner**, não em armazenamento permanente, com reutilização dos segmentos já decifrados. **Não foi testado CDN real, edge cache, TLS, Supabase Auth nem backend de produção.** Há controle de empresa no gateway de QA por token sintético validado e seleção de segmentos; a tabela TEMP não possui RLS própria e depende dessa validação + verificação de associação ao chamar o RPC. Não alegar isolamento produtivo certificado.
7. ACK deste ensaio confirma **verificação do arquivo/manifesto** no PostgreSQL de QA, somente após ler/autenticar o conjunto; retry de ACK idempotente. **Não é o ACK do player Android.** Sem exclusão de originais.

## Dados PASS/FAIL dos logs finais

| Verificação | Resultado |
|---|---|
| Runner A / Runner B | **PASS / PASS** |
| Eventos comerciais originais preservados por banco QA | **664** |
| Agregados diários em `qa_rpc.daily` | **276** |
| Cópia permanente adicional de eventos | **0**, tabela `qa_rpc.read_events` inexistente em QA |
| Segmentos externos | **10** |
| Relatórios JSON completo, frio / quente | **48/48 PASS / 48/48 PASS** |
| Exportações, frio / quente | **48/48 PASS / 48/48 PASS** |
| Conferências adicionais de referência RPC original | **48** |
| GETs HTTP do object-store simulado em Runner B, incluindo falhas | **23** |
| Cache hits/misses dos segmentos | **262 / 21** |
| GETs de objeto durante série quente | **0** |
| Falhas de requisição injetadas | **2**, ambos tratados |
| Arquivo indisponível, adulteração e chave incorreta | **Rejeitados, PASS** |
| Restabelecimento após falha do arquivo | **PASS** |
| ACK apenas após verificação e replay sem duplicar | **PASS** |
| Tentativa de cruzar empresas no relatório sintético | **Não retornou dados cruzados** |
| Eventos sem relógio faturados | **0** |
| Diferença de JSON/CSV da exportação | **0 nos casos testados** |

### Latência da consulta completa, 48 amostras por grupo

| Caminho | P95 | P99 |
|---|---:|---:|
| RPC original sobre os eventos brutos PG17 | **38,087 ms** | **38,464 ms** |
| Arquivo criptografado sob demanda + TEMP SQL — cache frio | **70,220 ms** | **71,579 ms** |
| Mesmo fluxo — cache quente em memória | **66,660 ms** | **72,099 ms** |

**Importante:** nesta amostra, a consulta sob demanda é mais lenta que a consulta direta. Cache quente elimina novos GETs mas o P99 quente ficou numericamente **maior** que o frio; a variação de runner e custos de TEMP SQL não justificam concluir melhoria do P99. 48 consultas em localhost são insuficientes para prever latência sobre rede externa, centenas de TVs ou produção.

## Volume total — sem confundir economia hipotética com resultado observado

| Indicador observado | Runner A | Runner B |
|---|---:|---:|
| Banco antes de materializar o CQRS diário | **8.738.483 B** | **8.738.483 B** |
| Banco após CQRS diário, no ponto da coleta | **8.787.635 B** | **9.369.267 B** |
| Índices do histórico original | **335.872 B** | **335.872 B** |
| Índices do CQRS diário | **16.384 B** | **16.384 B** |
| Arquivo cifrado (somente objetos) | **346.020 B** | **346.020 B** |
| Manifesto | **3.781 B** | **3.781 B** |
| Referência JSON sintética dos testes | **4.196.959 B** | **4.196.959 B** |
| Chave AES sintética em artefato separado | **32 B** | **32 B** |
| **Soma banco B + arquivos + manifesto + referência + chave** | — | **13.916.059 B** |

**Advertências:** a referência JSON de **4,197 MB** existe para comparação QA e não seria necessariamente um artefato permanente de produção. O aumento de tamanho no banco B reflete também metadados e a tabela de ACK do teste e não equivale só ao custo do CQRS. A cifra adiciona espaço externo; o SQL temporário não é permanente mas pode consumir espaço transitório. **Não foi demonstrada economia líquida de bytes** porque todos os originais são obrigatoriamente preservados. Projeção diária + objetos cifrados + manifesto aumentam o total. Não retirar conclusões sobre Supabase Free a partir destes tamanhos sintéticos.

## Falhas testadas e limites

- Um GET com arquivo indisponível retornou falha; sem confirmação prematura. Após reativação, a leitura autenticada funcionou; arquivo com byte alterado falhou SHA; chave diferente falhou AEAD; ACK foi inserido uma vez e retry não o duplicou.
- A chave AES de **teste** foi transferida entre jobs como artefato GitHub separado, retido por **1 dia**; **não** há KMS, segregação real de acesso nem proteção de chave de produção. Os artefatos compartilham autorização do repositório, portanto esse desenho não serve para arquivos reais contendo dados de clientes.
- O manifesto contém SHA-256 dos segmentos, mas **não foi assinado por identidade criptográfica independente**. Manifesto editável e acesso a uma chave exposta são riscos. Persistência externa real, replicação entre provedores, restauração de backup sob pane de disco, acesso multiempresa no storage, logs de auditoria e rotação de chaves ficam pendentes.
- A comparação não implementa paginação sob arquivo imenso, compactação sem perda em esquema comercial implantado, custos de GET de provedor externo ou memória sob carga real. Os 664 eventos são sintéticos, e não milhões. O ciclo de tela/offline/cache do player Android não foi executado.

## Decisão

**PASS / GO para continuar QA**: foi possível evitar a segunda cópia permanente de eventos e reconstruir o **JSON completo dos dois RPCs** a partir de arquivos cifrados sob demanda no PostgreSQL17 descartável, com testes de integridade, isolamento sintético e retries.

**NO-GO para produção:** não há economia líquida demonstrada, latência sob demanda pior que baseline, chave KMS real ausente, manifesto ainda não assinado independentemente, controle de empresa dependente de gateway experimental e nenhuma medição de tráfego/cotas no Supabase. **Não alterar ou excluir originais, índices, Supabase, Vercel, player, APK ou TVs.**

**Próximo experimento útil:** em CI isolado, reduzir o custo de TEMP SQL por consulta (pool e preparação segura de conexão, sem estado de outra empresa), testar 100/300 consultas concorrentes sobre arquivo cifrado real em serviço HTTP QA, cache com quota/TTL por empresa, e estimar custos de storage/egress/GET mantendo backups íntegros; depois avaliar assinatura do manifesto e acesso de storage com chaves de teste não anexadas aos arquivos. Não realizar nenhum deploy enquanto a paridade e segurança não estiverem sustentadas sob carga.
