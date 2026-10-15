# Vision Mídia Digital — checkpoint de encadeamento SHA-256 de evidências

**Checkpoint inicial preservado:** `58e65f021f5c8a5899dccdf6bf986ddf07497c83`  
**Branch isolada:** `fix/advertiser-portal-safety-20261013`  
**Ambiente:** arquivos fictícios, SHA-256 local, testes Node e relatório somente leitura. **Nenhum staging remoto, Supabase, TV Box, player, APK, playlist, gateway, migration, Edge Function ou deploy de produção foi usado.**

## Escopo implementado

- `tests/fixtures/commercial-evidence-hash-chain.cjs`: cria e verifica uma **cadeia SHA-256** de 1–30 registros fictícios. Cada registro inclui o formulário integral redigido, índice de sequência, horário UTC, digest do registro anterior (`previousHash`) e digest próprio. Usa um marcador inicial fixo de 256 bits e separação de domínio `VISION-COMMERCIAL-EVIDENCE-CHAIN-V1`. A serialização canônica ordena chaves de objetos para evitar divergência apenas por ordem de propriedades, mas preserva as listas.
- `tests/commercial-evidence-hash-chain.test.cjs`: **20 testes novos** para repetibilidade, encadeamento, alteração de campos/status, mudança de digest de evidência, troca de horário, falsificação de ponteiro anterior, remoção/reordenação de registros, recálculo de todo o histórico, extensão da cadeia e comparação com digest final informado separadamente.
- `tests/tools/commercial-evidence-hash-chain-report.cjs`: comando local somente leitura, com **dois snapshots sintéticos fixos** do repositório. Não recebe arquivos arbitrários como entrada, não grava dados e **não imprime** SHA-256 completos, URLs, tokens ou dados de clientes.
- `tests/commercial-evidence-hash-chain-cli.test.cjs`: **3 testes** do relatório redigido, bloqueio de segredos e independência de caminhos externos.
- Este documento registra o resultado; o histórico anterior e seu modelo JSON foram preservados.

## Resultados verificáveis

- **Regressão geral:** **508/508 PASS, 0 FAIL**; verificação de preservação de player/APK/APIs operacionais **PASS**.  
  https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38766199659
- Primeira execução com o novo módulo e 20 testes: **505/505 PASS**, guardião de arquivos operacionais aprovado.  
  https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38765978298
- **23 testes novos** desta rodada, além dos 485 anteriores. Nada foi habilitado, alterado ou publicado no Supabase ou na produção.

## Resultados demonstrados e limites

| Cenário sintético | Comportamento |
| --- | --- |
| Registros originais 1 e 2, sem alteração | Cadeia consistente; hash de cada registro corresponde ao próprio conteúdo e aponta para o anterior |
| Alteração de campo, evidência ou horário | `RECORD_DIGEST_MISMATCH` |
| Troca do digest do registro anterior | `PREVIOUS_LINK_MISMATCH` e, se não recalculado, `RECORD_DIGEST_MISMATCH` |
| Exclusão de registro intermediário, troca de índices | Sequência não consecutiva rejeitada pelo validador anterior |
| Exclusão do último registro | **Um prefixo pode continuar perfeitamente válido.** Só comparar contra uma referência final externa permite detectar o truncamento |
| Toda a cadeia reescrita e todos os hashes recalculados | **A nova cadeia pode parecer íntegra.** Comparação com um hash final original, preservado independentemente, encontra divergência |
| Digest final fornecido no próprio relatório coincide | Coincidência de bytes **não certifica** a autenticidade de quem o forneceu |
| Histórico declara `PASS` em staging | Não gera autoridade para conexão, migração ou deploy; a procedência continua sem autenticação |

**Conclusão:** esta cadeia oferece detecção de inconsistências quando há um **digest final anteriormente conhecido e protegido fora do histórico regravável**. Ela **não é** um log append-only, assinatura digital, carimbo do tempo confiável, testemunha independente ou garantia contra alguém que consiga reescrever tanto os registros quanto o digest de referência. O teste aceita um `expectedHead` como comparação opcional, mas **não atesta a procedência dessa referência**. A ferramenta permanece totalmente offline.

## Reprodução somente local

```bash
node tests/tools/commercial-evidence-hash-chain-report.cjs
npm test
```

O primeiro comando deve exibir `ÍNTEGRA NO LABORATÓRIO`, sem referência externa fornecida, e registrar expressamente que conexões reais/deploy não estão autorizados. Ele não exporta tokens nem a cadeia inteira e não recebe argumentos que permitam ler dados de clientes.

## Situação de segurança do produto

O portal comercial permanece **não homologado**: **0/17 critérios de staging concluídos**, 15 `NOT_RUN`, dois `BLOCKED`. Os bloqueios `SQL-01` e `SQL-02` persistem porque o SQL revisável `supabase/sql/advertiser-portal.sql` concede leitura ampla de `vision_commercial_revisions` e usa `to_jsonb(r)` na RPC, expondo metadados `source_*` em acesso de anunciante. A correção segue **somente** na fixture `tests/fixtures/commercial-safe-projection-lab.sql`, sem aplicação em banco real.

Não tratar o resultado dos testes sintéticos como certificação, autorização de staging, liberação de anúncios comerciais nem capacidade de revogar mídia previamente entregue.

## Próxima etapa segura

Projetar, **somente em laboratório**, a especificação de um **registro externo e independente do hash final** (sem credenciais nem integração remota), com testes de rotação da âncora, detecção de truncamento e restrições de acesso à referência. A implementação futura de armazenamento imutável/assinaturas exigiria seleção de serviço, revisão de privacidade e autorização específica, não sendo consequência automática de CI verde.

**Regra permanente:** não restaurar baseline antigo, não mexer no player oficial, APK, playlists, device-gateway, Supabase, Edge Functions, deploy ou TVs de clientes. Nenhuma mudança em produção sem autorização específica.
