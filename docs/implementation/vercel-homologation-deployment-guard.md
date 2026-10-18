# Bloqueio de deploy da homologação — validação local

Base local preservada: `7cb3b3f0938402b1c169df77d630d0b3c6f275bf`, descendente de `f81324089265c6ee46a623c3a9523b789a96256b`.

## Mudança restrita

O `vercel.json` recebe exclusivamente `git.deploymentEnabled["fix/advertiser-portal-safety-20261013"] = false`. Demais configurações permanecem idênticas. Nenhuma outra branch é desabilitada.

Nos sete workflows que protegiam `vercel.json` por diff, esse arquivo passa a ser verificado por `scripts/verify-vercel-homologation.cjs` antes do diff dos demais caminhos. O verificador aceita somente o SHA-256 exato `66bffc3f95828b1ad7195d42189c46a08826c09e15e5c0ccbbb66e855bf249e9`; rejeita arquivo ausente, diretório, symlink e qualquer conteúdo diferente. Todos os outros caminhos protegidos continuam na verificação Git original. A exceção não permite ajustes de rotas, headers, curinga ou outras branches.

Esse bloqueio está preparado localmente. Não foi enviado ao GitHub e ainda não está ativo no Vercel. Ele não bloqueia deploy manual, outros provedores ou workflows GitHub Actions. A branch local de revisão também não está coberta pela chave: não enviar essa branch para publicação.

## Evidências

- Node 22.23.3; testes com `NODE_OPTIONS='--experimental-strip-types --disable-warning=UNDICI-EHPA'` conforme diagnóstico anterior do aviso de proxy.
- 12 testes novos: inicialmente 12 falhas, depois 12/12 PASS.
- Regressão integral: **673/673 PASS**, zero falhas, cancelados, ignorados e TODO.
- `git diff --check`: PASS.
- Comparação dos sete workflows: apenas troca de proteção de `vercel.json` pelo guard; demais comandos e caminhos intactos.
- YAML analisado: guard e diff na mesma etapa, guard executado primeiro nos sete workflows.
- Revisão independente somente leitura: nenhum bloqueador na preparação local; riscos do futuro push descritos abaixo.

## Pendências antes de qualquer push

O projeto Vercel `vision-midia-digital` teve deploy com `source=git` da branch de homologação em f813240. Há também `visionmidiadigital2` ligado ao mesmo repositório. A configuração retornada pelas ferramentas não expõe todos os controles de deploy do painel; não alegar auditoria completa de todas as integrações.

Alterar os workflows `vision-diagnostic-apk.yml` e `vision-diagnostic-android-tv-emulator.yml` satisfaz os filtros de paths de ambos. Um push para a branch de homologação acionaria compilação do APK de diagnóstico e, no segundo, o emulador. Não é o APK de cliente, mas essa execução não foi autorizada neste bloco e não ocorreu. As condições desses jobs devem ser tratadas em um próximo bloco antes do envio, preservando os testes e a possibilidade de execução manual aprovada.

Decisão: manter o candidato local e preservar os triggers atuais nesta rodada, em vez de ampliar a alteração autorizada. Custo: o bloqueio de Vercel sozinho ainda não torna o push pronto para execução.

Nenhum push, deploy, merge, migration, build Android ou alteração de serviço remoto executado. Player, APK de cliente, playlists, bancos e arquivos operacionais fora da exceção permanecem preservados. **SQL-01/SQL-02 seguem BLOCKED.** A aprovação local não libera staging ou produção.

Próxima retomada: revisar contenção dos dois workflows de diagnóstico antes de push; manter o checkpoint local e os 673 testes aprovados, sem publicação automática.

## Continuação — diagnóstico somente manual

A pendência dos dois workflows foi resolvida localmente sobre `492f58d00bb4e1382e81b872d2562a7303ff3f8e`: removidos somente os blocos `on.push` de `vision-diagnostic-apk.yml` e `vision-diagnostic-android-tv-emulator.yml`. Ambos mantêm `workflow_dispatch`. Os jobs, permissões, verificações, compilação e testes de emulador foram preservados para futura execução manual autorizada.

Validação estrutural YAML: antes da alteração, a exigência de execução somente manual falhou; depois, ambos passaram. Comparação estrutural confirmou igualdade completa dos documentos após remover exclusivamente o gatilho push da versão anterior. `git diff --check` passou. Regressão integral executada novamente: **673/673 PASS**, zero falhas, cancelamentos, ignorados ou TODO.

Nenhum APK foi compilado, emulador iniciado ou workflow remoto disparado. Nenhum push, deploy, merge ou migration realizado. SQL-01/SQL-02 permanecem bloqueados. Todas as alterações continuam locais: a remoção dos gatilhos e o bloqueio Vercel só terão efeito remoto quando forem enviados para a branch original.

Próxima etapa: conferir novamente o HEAD remoto e as integrações de publicação antes de propor o envio dos commits locais à branch `fix/advertiser-portal-safety-20261013`. Não enviar a branch local de revisão, que não está no bloqueio Vercel. Esta validação não comprova ausência de integrações externas não auditadas.
