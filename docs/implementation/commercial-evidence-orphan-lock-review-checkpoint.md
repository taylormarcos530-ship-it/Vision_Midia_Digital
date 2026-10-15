# Vision Mídia Digital — Checkpoint: recuperação revisada de lock abandonado

**Checkpoint anterior:** `8281534d5834262287db2ead8dcc6b47272985ea`  
**Branch de laboratório:** `fix/advertiser-portal-safety-20261013`  
**Objetivo:** testar bloqueios locais `writer.lock` que sobrevivem ao encerramento de um processo escritor fictício, **sem alterar o módulo persistente existente, serviços reais, contas, TVs ou produção**.

## Validação

- **Regressão final:** **596/596 PASS, 0 FAIL** e proteção dos arquivos operacionais **PASS**: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38793558465
- **Regressão intermediária:** **593/593 PASS**, quando o módulo de recuperação e seus 17 testes iniciais já estavam presentes: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38793363858
- **20 testes novos** (17 do módulo, 3 do comando local) e os **576 testes anteriores preservados**.
- Diferença esperada: **cinco arquivos** exclusivamente em `tests/` e documentação. Nenhum deploy, migration, alteração operacional ou merge foi autorizado nesta etapa.

## Arquivos criados

- `tests/fixtures/commercial-evidence-lock-review-lab.cjs`: inspeção e **liberação manual simulada** do lock sob pasta `vision-custody-durable-*` no diretório temporário do sistema. O código não é usado pelo player ou backend operacional.
- `tests/commercial-evidence-lock-review-lab.test.cjs`: simula inclusive **um subprocesso Node real que cria o lock e termina**, além de proprietário ainda ativo, falta de marcador, dados adulterados, pin SHA-256 divergente, corrupção do ledger, ausência da dupla revisão, conteúdo inesperado na pasta e retomada sem duplicidade.
- `tests/tools/commercial-evidence-lock-review-report.cjs`: demonstração local do término do subprocesso, negativa sem revisão, liberação controlada e nova escrita sintética. Apaga seu diretório de ensaio ao finalizar; não aceita parâmetros para navegar arquivos externos.
- `tests/commercial-evidence-lock-review-cli.test.cjs`: três verificações da demonstração e da ausência de token, PID, hash completo e caminho privado na saída.
- Este checkpoint.

## Resultados observados

| Cenário | Resultado observado |
| --- | --- |
| Não há `writer.lock` | `NO_LOCK` |
| Lock antigo sem `owner.json` íntegro | `OWNER_UNKNOWN`; **não liberar** |
| PID do marcador ainda em execução | `OWNER_STILL_RUNNING`; **não liberar**, mesmo com aprovações simuladas |
| Subprocesso de laboratório cria marcador e encerra | `ORPHAN_REVIEW_REQUIRED`; **não remover na inspeção** |
| Proprietário encerrado, mas falta qualquer confirmação revisora | `DUAL_REVIEW_REQUIRED` |
| Proprietário encerrado, revisões sintéticas e ledger compatível com cabeça fornecida | `SIMULATED_MANUAL_LOCK_RELEASE` |
| Tentativa de escrever enquanto o lock persiste | `LOCK_BUSY` |
| Nova gravação após a liberação simulada e validada | `COMMITTED` |
| Gravação já concluída antes do encerramento | Nova instância retorna `ALREADY_COMMITTED`; **sem duplicidade** |
| Pin posterior divergente do ledger, ou JSON do ledger inválido | `LEDGER_INVALID_OR_PIN_MISMATCH`; **não liberar** |
| Marcador adulterado, symlink de lock ou arquivo adicional dentro dele | Recusa de desbloqueio |

### Procedimento de demonstração (apenas fixtures)

```bash
node tests/tools/commercial-evidence-lock-review-report.cjs
npm test
```

O primeiro comando só escreve numa pasta temporária fictícia e remove tudo ao fim; o segundo executa a suíte completa. A verificação de operação real **não foi feita nem solicitada**.

## Modelo de confiança e limitações

1. **Somente ensaio Node/Linux em diretório temporário.** A API consulta existência do PID com `process.kill(pid, 0)`; isso não autentica identidade, tempo de inicialização ou exclusividade do processo. **PID pode ser reutilizado**, marcadores podem ser falsificados e um processo não cooperativo pode causar uma corrida. Erros de consulta ou proprietário ativo **bloqueiam**, mas isso não faz desta rotina uma recuperação segura para múltiplos hosts ou produção.
2. **Marcador não assinado.** `owner.json` contém um checksum sem chave sobre campos sintéticos; detecta parte das alterações acidentais, mas não garante autenticidade. Não é um testemunho confiável sobre a morte de um escritor real.
3. **Duas revisões são booleans de laboratório**, não identidade real, dupla aprovação auditada, RBAC ou assinatura eletrônica. A remoção da trava acontece somente no namespace sintético controlado, e ainda assim deve ser considerada uma simulação; não reutilizar o módulo como utilitário de manutenção de produção.
4. **Cabeça SHA-256 fornecida não é uma referência externa certificada.** O método confronta um valor passado pela fixture com um ledger cujo checksum é igualmente sem chave; um agente com acesso de escrita e a capacidade de substituir ambos pode criar um conjunto coerente. Nenhuma prova de proveniência real.
5. **Não há recuperação automática.** Marcador ausente/desconhecido, PID ativo ou incerto, corrupção e divergência de cabeça permanecem bloqueados. A ferramenta não remove arbitrariamente locks sem dono reconhecido nem aplica fallback silencioso.
6. **Sem garantias transacionais distribuídas.** Não foram testados relógios confiáveis, queda de energia, NFS, múltiplas máquinas, lock leasing, fencing tokens ou alteração por processo malicioso. Um projeto de custódia real requer mecanismo transacional e controle de identidade independente.

## Situação do portal comercial — bloqueios intactos

O checklist de staging segue **0/17 critérios homologados**; `SQL-01` e `SQL-02` continuam **BLOCKED**. O arquivo de revisão `supabase/sql/advertiser-portal.sql` ainda inclui privilégios amplos sobre revisões e `to_jsonb(r)` na RPC, podendo expor `source_media_id`, `source_storage_path` e metadados internos. A alternativa segura permanece apenas na fixture `tests/fixtures/commercial-safe-projection-lab.sql`, sem alteração de Supabase real.

**Próxima etapa segura:** testar, **somente offline**, recuperação quando o processo é encerrado durante as diferentes fases do commit, distinguindo arquivo temporário órfão, `rename` concluído com confirmação ausente, lock abandonado e referência independente divergente. Em seguida, revisar se o mesmo bloqueio continua impedindo reprocessamento duplicado. Não criar daemon de limpeza automático nem conectar serviços externos.

**Preservação:** nenhum merge, deploy, migration, publicação Edge Function ou atualização APK; não modificar player, playlists, gateway, Supabase ou TVs de clientes. Todos os resultados deste documento são exclusivamente de laboratório.
