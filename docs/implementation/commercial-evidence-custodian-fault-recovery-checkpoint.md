# Vision Mídia Digital — Checkpoint de tolerância a falhas do guardião sintético

**Checkpoint anterior preservado:** `5f2d73eb0417067ef8c54cccfcf135b920ca8e67`  
**Branch isolada:** `fix/advertiser-portal-safety-20261013`  
**Escopo:** somente arquivos fictícios, Node local e verificações GitHub Actions; nenhuma ação em staging, produção, rede de clientes, Supabase, Netlify/Vercel ou dispositivos.

## Evidência de execução

- **Regressão final 557/557 PASS, 0 FAIL**, incluindo a verificação de não alteração em arquivos oficiais do player e APIs operacionais (**PASS**): https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38774534876
- **25 novos testes nesta rodada** (22 cenários de armazenamento/concorrência/backup e 3 do comando local). Os 532 anteriores também permaneceram verdes.
- Execução intermediária com o núcleo e 22 novos testes: **554/554 PASS**, guard de produção aprovado: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38774334106
- Diferenças limitadas a `tests/` e a este documento. Nenhuma atualização de SQL, bucket, aplicativo Android ou player.

## O que foi implementado

1. `tests/fixtures/commercial-evidence-custodian-faults.cjs`: guardião **fictício em memória** que usa recibos e a cadeia SHA-256 já existentes. Exige `expectedHead` (compare-and-swap) para inserir nova âncora, valida avanço do número e cobertura do histórico sintético, registra chaves opacas de idempotência e recusa atualizações concorrentes baseadas em cabeça antiga.
2. Controles de acesso **apenas simulados** com papéis `WRITER`, `REVIEWER`, `OPERATOR` e `OUTSIDER`. Estes rótulos não equivalem a autenticação nem a contas reais. O `WRITER` tenta inserir âncoras; `REVIEWER` lê e confronta backups; `OPERATOR` liga/desliga a disponibilidade fictícia; terceiros não recebem acesso.
3. `tests/commercial-evidence-custodian-faults.test.cjs`: 22 testes para indisponibilidade e retomada, concorrência CAS, perda simulada de confirmação seguida por nova tentativa idempotente, campos inesperados, papéis recusados, recibo adulterado, falhas de backup e auditoria sem dados sensíveis.
4. `tests/tools/commercial-evidence-custodian-fault-report.cjs`: demonstra **sem entrada externa** uma execução totalmente sintética. Não contém conexões remotas, escrita em disco nem comandos de migração/deploy.
5. `tests/commercial-evidence-custodian-fault-cli.test.cjs`: 3 testes garantindo resultado reproduzível e ausência de tokens, hashes completos, IDs de requisições e caminhos de mídia no relatório.
6. Este checkpoint consolida o procedimento.

## Cenários e resultados

| Caso testado | Resposta da simulação | Consequência |
|---|---|---|
| Primeira inserção com cabeça correta | `COMMITTED` | Acrescenta uma âncora válida ao histórico de memória |
| Dois escritores com a **mesma cabeça antiga** | `COMMITTED` e `CONFLICT_STALE_HEAD` | Somente a primeira inserção é aceita |
| Envio concluído e confirmação ficticiamente perdida | `ALREADY_COMMITTED` na tentativa repetida | Chave idempotente impede duplicação |
| Mesmo identificador reutilizado para outra inserção | `IDEMPOTENCY_CONFLICT` | Recusa tentativa inconsistente |
| Guardião desligado antes da operação | `UNAVAILABLE` | Não grava âncora nem sinaliza sucesso |
| Guardião volta a funcionar | `COMMITTED` em nova tentativa válida | Conclui após retorno, com cabeça ainda correta |
| Escritor tenta pular sequência/usar recibo adulterado | `INVALID_RECEIPT` | Não altera a cabeça registrada |
| Backup anterior ao último recibo, confrontado com digest preservado | `INDEPENDENT_HEAD_MISMATCH` | Rejeita restauração regressiva |
| Backup correto, com digest coincidente | `MANUAL_REVIEW_ONLY` | **Não restaura automaticamente** e não autentica o custodiante |
| Backup cujo recibo foi manipulado | `CORRUPTED_BACKUP_REJECTED` | Bloqueia substituição |
| Guardião indisponível na checagem de backup | `UNAVAILABLE` | Não produz aprovação por fallback |
| Acesso de terceiro e operação por papel inadequado | `DENIED` | Modelo recusa a operação |
| Auditoria local | Somente evento, código e ordem | Sem digests, tokens, IDs, cabeçalhos ou caminho do objeto |

## Limites importantes

**Nenhum guardião externo foi implantado.** Tudo usa objetos de memória no mesmo processo Node. Os papéis são strings de teste, não controle de identidade real; o `independentlyHeldDigest` foi passado localmente e **não foi entregue nem obtido de uma custódia independente autenticada**. Os testes não comprovam isolamento entre contas reais, consistência transacional de um banco concorrente, latência de rede, recuperação após falha de disco, persistência, operação de múltiplos processos, retenção imutável, disponibilidade ou proteção contra um invasor que reescreva todas as referências.

**CAS e idempotência em memória não substituem transações atômicas persistentes.** Em aplicação real, haveria ainda testes de execução simultânea em processos separados, perda de conexão após commit, reeleição de liderança, leitura eventualmente consistente, durabilidade de backups, política de retenção e auditoria de acessos.

**Restore:** a rotina deste laboratório é de **inspeção somente leitura**. Mesmo com backup idêntico à cabeça esperada, o retorno `MANUAL_REVIEW_ONLY` não prova procedência e **nunca regrava o histórico**. Não há ações em produção e nenhuma autorização de recuperação sobre dados reais.

## Reprodução com fixtures fictícias

Em um checkout da branch de segurança:

```bash
node tests/tools/commercial-evidence-custodian-fault-report.cjs
npm test
```

O comando emite somente um quadro resumido com os status das simulações. Não informa digests completos nem recebe caminhos de arquivos arbitrários. O segundo comando executa a regressão de segurança existente.

## Segurança comercial ainda pendente

**0/17 critérios de staging homologados**: 15 continuam `NOT_RUN`, e `SQL-01`/`SQL-02` seguem **BLOCKED** pelo SQL original `supabase/sql/advertiser-portal.sql` (privilégios de leitura de colunas `source_*` e RPC que serializa `to_jsonb(r)`). A correção de projeção e privilégios está apenas na fixture `tests/fixtures/commercial-safe-projection-lab.sql`. **Não aplicar migrations ou ativar o portal** antes de revisão e permissão específicas.

A camada comercial do portal não foi ativada e nenhum player, playlist-base, comando de TV ou campanha em produção foi alterado.

## Próxima etapa segura

Especificar, **sem provisionar serviço**, um contrato de persistência transacional para a custódia, incluindo idempotência **durável**, CAS atômico, retenção append-only, recuperação sob perda de confirmação e distinção entre disponibilidade e integridade. Em paralelo, manter como bloqueios de lançamento a revisão dos campos de origem no SQL e a homologação de preview comercial em staging segregado. Não criar recursos remotos, migrations, Edge Functions ou deploys sem autorização.

**Regra permanente:** não restaurar baseline antigo, não remover funcionalidades operacionais e não modificar player, APK, playlists, gateway, Supabase ou produção sem autorização expressa.
