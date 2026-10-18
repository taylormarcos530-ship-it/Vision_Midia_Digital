# Vision Mídia Digital — Checkpoint: inspeção e quarentena local de temporários

**Origem imutável:** `f81324089265c6ee46a623c3a9523b789a96256b`
**Branch isolada:** `fix/advertiser-portal-safety-20261013`
**Escopo:** exclusivamente `tests/fixtures/`, `tests/*.test.cjs` e esta documentação. **Sem** alterações operacionais, player, APK, gateway, playlists, Supabase, Edge Functions, migration ou deploy.

## Contrato do laboratório

O novo utilitário `tests/fixtures/commercial-evidence-temp-quarantine-lab.cjs` separa duas operações:

1. `inspectOrphanTemps`: inspeciona, sem gravar, somente arquivos com nome no padrão `ledger-<pid>-<timestamp-ms>.tmp` dentro de uma pasta imediatamente subordinada a `os.tmpdir()` com prefixo estrito `vision-custody-durable-`. Valida a identidade do diretório, o pin independente e a consistência do ledger confirmado; verifica o tipo do candidato, `nlink=1`, limite de bytes, abertura com `O_NOFOLLOW`, inode e digest. Classifica apenas estados sintéticos íntegros e consistentes como `NEXT_UNCOMMITTED` ou `DUPLICATE_COMMITTED`.
2. `quarantineOrphanTemp`: exige o nome exato do candidato, seu fingerprint coletado na inspeção, ticket sintético e duas confirmações explícitas. **Qualquer `writer.lock`, mesmo inválido, bloqueia a operação.** Com ledger ainda íntegro e cabeça pinada, repete a inspeção e cria uma **cópia de revisão por hardlink**, sem apagar o `.tmp` original, dentro de `quarantine/` no diretório local controlado. Não cria nem substitui `ledger.json`, não destrói o arquivo, não remove symlinks e não sobrescreve nomes já existentes (criação exclusiva do destino por `linkSync`).

A inspeção pode ser feita enquanto o lock órfão ainda existe; a quarentena é bloqueada até **uma revisão/liberação separada do lock** pelo laboratório anterior. Os temporários não são adotados como commits e não aumentam a contagem de recibos. Nomes desconhecidos e arquivos de outros diretórios ficam intactos.

## Reforço adversarial após a primeira revisão

O laboratório passa a comparar também **todo o prefixo confirmado** de `receipts` e `requests` antes de classificar um temporário como continuação válida ou duplicata. Igualdade da cabeça SHA-256, isoladamente, não é suficiente para rotular um histórico diferente como confirmado.

A movimentação não usa mais `renameSync`, cujo comportamento pode substituir um destino que apareça entre a inspeção e a troca de nome. Em filesystem local compatível, `linkSync(source,dest)` cria exclusivamente a segunda referência do mesmo inode e falha com `EEXIST` se o destino já existir. Em seguida verifica inode, contagem de links, tamanho e fingerprint antes de retornar `QUARANTINE_COPY_REVIEW_REQUIRED`. **Nenhum `unlinkSync` é chamado:** o nome original e a referência em `quarantine/` permanecem. Isso evita a exclusão acidental de um nome de arquivo reutilizado na janela entre conferir inode e apagar origem. Se algo falhar depois do hardlink, retorna `QUARANTINE_INCOMPLETE` e mantém ambos os nomes para análise, sem limpeza automática.

**Testes acrescentados à suíte original:** dez cenários, totalizando **28 testes de quarentena propostos**. Os cenários adicionais cobrem dois temporários em paralelo, alteração do histórico de idempotência com checksum recalculado, colisão de destino no instante do hardlink, falha após criar hardlink, modificação no instante da transferência e preservação de arquivos estranhos. O smoke separado original executado localmente passou em **10/10** cenários (ampliado para 12/12 na última rodada) com adaptadores para as dependências do ledger; ele **não substitui** os testes integrados nem a execução completa do GitHub Actions.

## Cenários e invariantes

- Arquivo abandonado após `AFTER_TEMP_SYNC` inspecionado sem ser promovido; lock impede a movimentação.
- Quarentena após liberação revisada do lock e segunda revisão sintética; histórico confirmado continua intacto, inclusive na rotação do segundo recibo.
- A escrita posterior ocorre normalmente e gera `COMMITTED` apenas por `publish`, não pela quarentena.
- Pin divergente, ledger corrompido, candidato alterado, link simbólico, hardlink, caminho externo/traversal, diretório de quarentena symlink e colisão de destino bloqueiam a movimentação.
- Arquivos e nomes não reconhecidos nunca são removidos; o temporário selecionado permanece em seu nome original, e a cópia vinculada na subpasta exige revisão; não se cria segunda cópia em caso de colisão.

## Limitações (obrigatórias)

- **Não** é um mecanismo seguro de produção. Os aprovadores booleanos/ticket não são identidades autenticadas. O fingerprint SHA-256 sem chave não resiste a um adversário com controle do filesystem e do processo.
- Apesar da criação exclusiva do destino, a sequência `linkSync` / verificações **não é uma transação atômica** e ainda possui janelas TOCTOU sob processos hostis que tenham acesso de escrita à pasta. **A etapa de remoção da origem foi suspensa**: ficam dois hardlinks em um cenário válido, exigindo revisão manual. Um ator com acesso à pasta pode ainda trocar arquivos ou links durante a operação; não usar sob escrita paralela não confiável.
- Um temporário válido é apenas um arquivo **não confirmado**; sua verificação não autentica origem externa. Nem `rename` nem `fsync` simulado demonstram recuperação após queda elétrica real.
- A pasta de quarentena é isolada e sintética. O laboratório não implementa expiração, exclusão, recuperação automática, reimportação nem política de retenção de documentos reais.
- O teste não altera o fluxo original de `publish` e **não** aprova nenhum dos critérios de staging real, implantação, campanhas comerciais nem instalações em TVs de clientes.

## Como verificar sem conectar serviço real

```bash
node --test tests/commercial-evidence-temp-quarantine-lab.test.cjs
npm test
```

**Execução real neste checkpoint de continuação:** `node --test validate-adversarial-offline.cjs` -> **10 PASS / 0 FAIL** (testes locais com adaptadores; não entram no repositório). Os 28 testes integrados aguardam checkout completo do código do GitHub e a regressão de 613 testes anteriores aguarda nova execução da CI. Não alegar 641/641 PASS até o GitHub confirmar.

As ações aprovadas devem ser registradas na execução do GitHub Actions da branch isolada. Somente arquivos novos de laboratório/documentação compõem esta rodada.

## Pendências anteriores mantidas

Os bloqueios de SQL `SQL-01` e `SQL-02` permanecem **BLOCKED**. O script `supabase/sql/advertiser-portal.sql` não recebeu ajustes, migrations não foram aplicadas, e nenhum dos 17 critérios de staging real foi homologado. O processo de produção segue preservado.

**Próximo passo proposto:** quando o acesso de escrita for restabelecido, aplicar este patch **a partir do commit `f813240`**, rodar `npm test` na branch isolada e conferir diff restrito aos cinco arquivos novos. Aguardar CI verde antes de efetivar qualquer checkpoint remoto. Depois disso, revisar teste de recuperação manual dos hardlinks incompletos, sem automatizar exclusões. Nenhum deploy, merge ou migration é autorizado.

---

## Rodada seguinte — reconciliação **somente de leitura** de hardlinks incompletos

O checkpoint `f813240` continua como base, sem mudança no repositório remoto. Esta continuação adiciona apenas:

- `tests/fixtures/commercial-evidence-quarantine-reconciliation-lab.cjs` — `inspectInterruptedQuarantine({directory,name,expectedFingerprint})`.
- `tests/commercial-evidence-quarantine-reconciliation-lab.test.cjs` — 20 novos testes Node sobre o filesystem real e recursos sintéticos temporários.

A inspeção não executa `unlink`, `link`, `rename`, `mkdir` nem qualquer operação de escrita. Requer o identificador exato e fingerprint previamente obtidos na etapa de inventário; limita-se à pasta sintética imediatamente abaixo do diretório temporário do sistema. Não percorre diretórios externos nem segue symlinks. **Não autentica nem valida `ledger.json` ou o pin independente; todos os resultados trazem `ledgerVerified:false`, `canAutoResolve:false`, `canConnectStaging:false` e `canDeployToProduction:false`.**

Saídas de diagnóstico possíveis:

- `SOURCE_ONLY_REVIEW_REQUIRED`: temporário selecionado permanece com um único link e o destino de quarentena não existe.
- `PAIRED_HARDLINK_REVIEW_REQUIRED`: o mesmo inode está nos dois nomes, há exatamente dois hardlinks e os bytes correspondem ao fingerprint informado. Nenhum nome é removido.
- `DESTINATION_ONLY_REVIEW_REQUIRED`: destino inspecionado após a remoção do nome temporário. Não significa validação ou autorização de restauração.
- `CONFLICTING_FILES_REVIEW_REQUIRED`: dois nomes existem, mas não constituem o mesmo par esperado.
- `SELECTION_CHANGED_REVIEW_REQUIRED`, `UNSAFE_FILE_REVIEW_REQUIRED`, `UNSAFE_QUARANTINE_DIRECTORY`, `LOCK_PRESENT_REVIEW_REQUIRED` e outros: **não há tratamento automático**. A verificação apenas relata o bloqueio para avaliação manual.

Nenhuma saída equivale a `RECOVERED`, `COMMITTED` ou `SAFE_TO_DELETE`. Dados mantidos na pasta de quarentena não são importados para o ledger. Este é um instrumento de diagnóstico de estrutura do filesystem, **não** uma certificação de autenticidade, origem ou durabilidade. Em particular, erros de I/O, colisões de nomes, mudanças concorrentes e diretórios controlados por outro processo exigem investigação externa antes de qualquer correção.

**Resultados medidos neste ambiente:**

- 20/20 novos testes da ferramenta read-only — PASS, 0 falhas (`node --test tests/commercial-evidence-quarantine-reconciliation-lab.test.cjs`).
- 12/12 testes adversariais do pacote atual com adaptadores locais — PASS, 0 falhas (ver arquivo complementar de validação; **não** equivale à execução integrada).
- 28 testes de quarentena e 613 testes históricos — **não reexecutados conjuntamente**; CI integrada ainda pendente.
- Todos os arquivos do repositório no patch consolidado são **aditivos**: apenas cinco novos arquivos de laboratório e documentação. Nenhum arquivo existente no commit `f813240` é substituído.

**Próxima revisão segura:** repetir a CI completa contra um checkout verificado exatamente em `f813240` e conferir o diff restrito aos cinco arquivos novos; somente depois autorizar commit na branch de testes. Permanece proibido ativar serviço de produção, aplicar SQL, fazer merge ou alterar APK/TVs.

---

## Rodada de bloqueio da exclusão não atômica (continuação)

A revisão da janela TOCTOU detectou que `lstat(source)` seguido de `unlink(source)` poderia atingir um arquivo diferente se outro processo reutilizasse o caminho nesse intervalo. Por isso, o laboratório agora **não executa `unlinkSync`** em nenhum caminho da operação. Quando a criação exclusiva por `linkSync` passa, mantém o original e a referência na pasta `quarantine`, com status `QUARANTINE_COPY_REVIEW_REQUIRED`. A situação é inspecionável pelo revisor read-only anterior como `PAIRED_HARDLINK_REVIEW_REQUIRED`, mas **não é uma quarentena final, nem autoriza limpeza**. Uma corrida entre verificação e hardlink continua possível; a operação não se destina a um adversário com escrita concorrente no mesmo diretório.

Dois testes integrados adicionais (total **28 casos propostos**) e dois testes com adaptadores exercitam a substituição do nome original após criação do hardlink e a proibição de `unlink`. Esta rodada foi testada localmente em Node 22 com **12/12 testes adversariais com adaptadores** e **20/20 de reconciliação read-only**, todos aprovados. Os 28 testes integrados e 613 anteriores seguem pendentes de CI no checkout oficial.


## Homologação integrada local — 17/10/2026

Esta seção atualiza os estados pendentes das rodadas históricas acima. Base verificada: `f81324089265c6ee46a623c3a9523b789a96256b`; árvore `11dbad1fd4e45a9050570fd125ce626f16469705`.

- Quarentena e reconciliação: **48/48 PASS** (28 + 20), zero falhas, cancelamentos ou ignorados.
- Regressão integral: **661/661 PASS** (613 anteriores + 48 novos), zero falhas, cancelamentos, ignorados ou TODO.
- Node **22.23.3**, dependências instaladas com `npm ci --ignore-scripts --no-audit --no-fund`.
- Primeira regressão: 654 PASS / 7 FAIL por aviso experimental `UNDICI-EHPA` em stderr de CLIs. Um processo Node vazio reproduziu o aviso em `setupHttpProxy`; não era falha do projeto.
- Ajuste exclusivo no ambiente: `NODE_OPTIONS='--experimental-strip-types --disable-warning=UNDICI-EHPA' npm test`. Mantidos proxy, certificados, assertivas e demais avisos.
- Os **369 arquivos originais** permaneceram idênticos ao ZIP verificado. Somente os cinco arquivos novos deste candidato compõem o diff.
- Revisão independente: nenhum bloqueador no escopo sintético declarado. Corrigida a contagem documental antiga: 613 + 28 = 641; com reconciliação, 661.

Resultado exclusivamente local: não substitui CI remota, staging real, testes de TVs ou produção. **SQL-01/SQL-02 permanecem BLOCKED**, e os 17 critérios de staging continuam sem homologação real. Não foram executados deploy, merge ou migrations. Limitações TOCTOU e revisão simulada continuam válidas.

O usuário autorizou o registro após a homologação. O commit é preparado localmente, sem push: o checkpoint remoto f813240 possui status de deploy Vercel concluído, de modo que enviar a branch pode acionar publicação automática. A restrição de não executar deploy foi preservada.
