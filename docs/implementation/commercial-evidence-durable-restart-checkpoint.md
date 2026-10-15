# Vision Mídia Digital — checkpoint de persistência sintética após reinicialização

**Checkpoint de origem:** `98f43f769d1dcc6942a5150f7598ef8042e6dbea`  
**Branch:** `fix/advertiser-portal-safety-20261013`  
**Escopo:** exclusivamente **laboratório offline**, evidências fictícias, diretório temporário controlado do runner e verificações Node. Não existe guardião independente real nem integração com Supabase, banco/Storage de cliente, player, APK, playlists, gateway, Edge, Netlify ou Vercel.

## Evidência verificada

- **Regressão final: 576/576 PASS; zero falhas**. Proteção dos arquivos operacionais do player e APIs: **PASS**. Execução final: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38785301296
- Execução inicial com 16 testes novos: **573/573 PASS**: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38785073937
- **19 testes novos**, além dos 557 anteriores. Os arquivos criados/alterados nesta rodada estão exclusivamente em `tests/` e nesta documentação. Não houve merge nem deploy.

## Implementação e separação de responsabilidades

- `tests/fixtures/commercial-evidence-durable-lab.cjs`: **novo módulo isolado**. Não altera o guardião de memória anterior. Grava em `ledger.json` **apenas** dentro de um diretório `vision-custody-durable-*` criado em `os.tmpdir()`; recusa qualquer diretório fora desse namespace controlado.
- O recibo de SHA-256 e a **chave de idempotência** ficam no **mesmo documento atômico**, evitando confirmar o recibo sem persistir a identidade da requisição. Os bytes são escritos num arquivo temporário novo (`O_EXCL` e `O_NOFOLLOW`), sincronizados com `fsync`, substituídos por `rename` e seguidos por `fsync` do diretório. O arquivo temporário é descartado nas falhas injetadas antes da substituição.
- Um lock de diretório `writer.lock` evita duas gravações simultâneas por processos **cooperativos**; caso o lock persista após travamento abrupto, a operação retorna `LOCK_BUSY` e **não remove automaticamente** o lock. A recuperação desses casos exigiria procedimento manual revisado.
- Ao reabrir, o código confere o formato, os recibos encadeados, os IDs de operação e um checksum local de toda a estrutura. Uma divergência **não** transforma o conteúdo inválido em ledger novo e não sobrescreve dados silenciosamente.
- É possível informar um `expectedPinnedHead` retido separadamente: a reabertura recusa uma cópia antiga do arquivo quando o hash da cabeça não corresponde. O laboratório **não autentica quem forneceu esse hash**, portanto não o considera uma testemunha confiável.
- `tests/commercial-evidence-durable-lab.test.cjs`: **16 testes** cobrindo recuperação após criar nova instância, leitura do arquivo num **segundo processo Node**, CAS, idempotência persistente, perda de confirmação, falhas injetadas e proteção contra corrupção, symlink, hardlink e rollback com referência conservada.
- `tests/tools/commercial-evidence-durable-report.cjs`: comando local que executa um ensaio fictício com diretório temporário, imprime apenas status e descarta todo o diretório no final.
- `tests/commercial-evidence-durable-cli.test.cjs`: **3 testes** de relatório, ausência de tokens/digests/IDs e inércia de argumentos de caminho externos.

## Resultado dos cenários

| Cenário | Resultado observado no laboratório | Interpretação |
|---|---|---|
| Reinicializar módulo após gravar recibo | `OK` com a cabeça e quantidade anteriores | Dados recuperados do arquivo local |
| Reabrir noutro processo Node | Cabeça correspondente e 1 recibo | Persistência observada entre processos |
| Reenviar uma solicitação já concluída | `ALREADY_COMMITTED` | Não duplica o recibo |
| Falhar antes da escrita do arquivo temporário | `SIMULATED_UNAVAILABLE` | Nenhum commit; nova tentativa pode gravar |
| Falhar após `fsync` do temporário e antes do `rename` | `SIMULATED_UNAVAILABLE` | Ledger antigo preservado, sem confirmação falsa |
| Simular perda da resposta após `rename` e `fsync` | `ACK_LOST_AFTER_COMMIT` | Novo processo lê recibo persistido; retry devolve `ALREADY_COMMITTED` |
| Segundo escritor com cabeça antiga | `CONFLICT_STALE_HEAD` | CAS compara contra estado de disco dentro de lock |
| Lock mantido por outro escritor | `LOCK_BUSY` | Não contorna a exclusão mútua nem assume sucesso |
| Alterar bytes/recibo de arquivo salvo | Exceção de checksum/JSON | Corrupção reconhecida, sem recriar um arquivo vazio |
| Abrir arquivo como symlink/hardlink | Rejeitado | Impede redirecionamento trivial da leitura |
| Restaurar backup antigo mas estruturalmente válido | Divergência com `expectedPinnedHead` | Impede aceitar cabeça antiga quando uma referência posterior foi preservada externamente |
| Fornecer recibo pulando a sequência | `INVALID_RECEIPT` | Não grava nem promove status |

## Limitações expressas

1. **Esta não é uma solução de persistência em produção.** `fsync` e `rename` foram exercitados no runner, mas o ensaio **não comprova** atomicidade e durabilidade em todos os sistemas de arquivos, quedas de energia, falha física de disco, NFS ou failover distribuído.
2. **Não há autenticação real.** O caminho sintético não é um repositório de dados de clientes, não existe operação externa e o checksum de integridade é **sem chave**: detecta alterações acidentais ou parciais, mas um agente capaz de reescrever arquivo e checksum pode criar uma nova estrutura coerente. A referência independente só ajuda se for efetivamente preservada sob controle separado.
3. **A concorrência depende de processos cooperativos no mesmo sistema de arquivos.** O lock atômico de diretório oferece recusa a escritores concorrentes; queda abrupta pode deixar `writer.lock` e parar novos commits até revisão manual. O laboratório não prova consenso distribuído, isolamento serializável do banco, segurança contra processo malicioso ou política de retenção imutável.
4. **A simulação de crash é por ponto de falha controlado.** Não interrompe energia nem valida injeção de falha de I/O durante `fsync` ou `rename`. `ACK_LOST_AFTER_COMMIT` indica que **somente a confirmação simulada** se perdeu; não representa perda dos dados.
5. **Sem backups reais ou restauração automática.** Nenhum comando recupera dados de cliente, publica recibos remotos ou modifica estado operacional. Não há autorização para staging e nenhuma função devolve autorização de deploy.

## Reproduzir apenas com dados fictícios

```bash
node tests/tools/commercial-evidence-durable-report.cjs
npm test
```

A primeira instrução cria um diretório **temporário** de ensaio, grava o registro fictício, reabre e imprime o resultado redigido; apaga o diretório ao terminar. O segundo comando executa a bateria local completa. Não mover evidências operacionais para a fixture e não adicionar credenciais.

## Bloqueios do portal comercial

**Staging real: 0/17 critérios homologados.** Os bloqueios `SQL-01` e `SQL-02` ainda persistem em `supabase/sql/advertiser-portal.sql`: `source_*` disponível por projeção/privilégios amplos de revisões e resposta `to_jsonb(r)` da RPC. A proteção SQL permanece somente em `tests/fixtures/commercial-safe-projection-lab.sql`; não foi aplicada em banco real.

**Próxima etapa segura:** preparar contrato offline de *recuperação de lock abandonado* com intervenção de revisor, distinção entre commit concluído e indefinido após crash real do processo, e rejeição de truncamento/restore regressivo com cabeça independente. Não implementar serviço externo sem autorização específica. **Nenhuma correção SQL, migração, Edge Function ou deploy foi realizada.**

**Preservação:** o player oficial, APK, playlists e campanhas ativas, gateway, Supabase, Netlify/Vercel e TVs dos clientes permanecem inalterados.
