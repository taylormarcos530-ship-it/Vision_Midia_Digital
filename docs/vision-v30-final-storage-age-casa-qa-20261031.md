# Vision V30 — Auditoria final do armazenamento + Casa QA + age/PostgreSQL 17 (31/10/2026)

**Status: homologação isolada PASS; NÃO autoriza publicação.** Branch `fix/playback-daily-retention-safe-20261030`.
Projeto Supabase real, Vercel, TVs, APKs e histórico real **não foram alterados**. Não foi solicitado nem realizado backup de produção. A retenção de 7 dias só foi acionada contra dados sintéticos dentro de PostgreSQL descartável; **permanece desativada na produção**.

## Baseline e evidências de código

- Branch fornecida pelo usuário: `7137e782bb4692bf477c3abec3836538183eb6c4`.
- O player da V30 conserva a fila original `vision_player_playback_queue_v1` e cria a chave de quarentena `vision_player_playback_quarantine_v30`.
- Correção adicional em `player.js`: `strictPlaybackStoredArray` interrompe operações ao detectar JSON danificado, em vez de tratar comprovantes como fila vazia e potencialmente sobrescrevê-los.
- A função `queuePlayback` mantém comprovantes antigos em quarentena caso a fila ultrapasse 2000 eventos e exista espaço livre. Se o armazenamento acaba completamente, o evento novo **não tem garantia de persistência**. Esta limitação física continua BLOQUEADORA de homologação na Casa.
- O gateway V30 preserva byte por byte todos os trechos da `device-gateway` v22 implantada fora de `playback` / `playback_batch`, conforme teste do fingerprint normalizado. Não implantar novas funções nem alterar push ou pareamento nesta etapa.

## Suítes finais executadas

- **Player localStorage real simulado, contratos gateway v22 e ACK:** https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41206024197 — sucesso, **14 testes de fila e erro de armazenamento + 5 de paridade com v22 + 8 de ACK = 27/27 PASS**.
  - JSON corrompido na fila e na quarentena: falha fechada, comprovantes persistidos preservados e nenhuma gravação enviada;
  - cota local cheia ao tentar arquivar, durante 2001ª entrada ou recuperação manual;
  - queda de rede, lote inválido, reenvio corrigido, proteção do payload original.
- **Retenção simulada, parada, backup age e restauração PostgreSQL17:** https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41206024144 — sucesso, commit testado `026d4355b07c7ece9c20cad1a1fa1ed1cbe0e97d`.
  - **PASS_7D_RETENTION**: 8000 eventos sintéticos consolidados em 17 ciclos, 2100 preservados, 10000 contabilizados em cinco variantes de relatórios;
  - **PASS_ROLLBACK_STOP**: gate `enabled=false` recusa mais compactação, sem perder 8000 dados resumidos, sem alterar relatório de 10000, sem aceitar duplicata;
  - **PASS_AGE_CIPHER_SHA256**: criptografia age com chave efêmera de teste, SHA-256 da cópia descriptografada igual à origem;
  - **PASS_AGE_WRONG_KEY / PASS_AGE_TRUNCATED_CIPHER**: rejeições confirmadas;
  - **PASS_RESTORE_ledger**: 512 segmentos e 8000 hashes, com digest preservado;
  - **PASS_RESTORE_archive**: 2 grupos, 8000 iniciadas e 8000 concluídas;
  - **PASS_RESTORE_raw**: 2100 linhas preservadas;
  - **PASS_RESTORE_REPLAY**: reenvio histórico recusado após restore; compactação continuou desligada.
  - É um dump PostgreSQL **sintético**, não backup de produção.
- Testes nativos anteriores Supabase Auth/JWT/RLS e Edge/Deno: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41204777967 — sucesso.
- Testes de escala anteriores com ledger segmentado em 300k IDs e concorrência: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41200627568 — sucesso.

## Pacote de homologação Casa

Gerado por workflow isolado; contém **somente cópias de fonte e documentos**, sem APK instalável, dados reais, tokens de produção, dump ou chave privada age.

- **Artefato GitHub:** https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41206024144/artifacts/13044343902
- Nome: `Vision-V30-Casa-QA-no-APK`
- ZIP interno: `vision-v30-casa-QA.zip`
- SHA-256 do ZIP interno: `10e1f851fe494c1abd746301dbac46d87038f7bf48864a52e91aeefd095f2de5`
- Inclui manifesto com commit da fonte, SHA256SUMS de todos os arquivos, roteiro Casa, rollback, `player-v30-QA.js`, `device-gateway-v30-QA.ts` e testes.
- **ATENÇÃO:** o SHA acima é do ZIP `vision-v30-casa-QA.zip` DENTRO do artefato do GitHub. O download do GitHub Actions pode ser outro ZIP externo com tamanho e hash diferentes. Verificar SHA do ZIP interno antes de utilizar.

## Questões não resolvidas — publicação bloqueada

1. Espaço cheio/corrupção: não é possível garantir comprovante NOVO após armazenamento físico esgotado; o app ainda não tem mecanismo de alerta/backup externo robusto. Testar na TV Box de bancada, sem produção, e decidir armazenamento durável.
2. Funcionalidade de recuperação ainda não é apresentada no painel; a função de recuperação é um helper de QA, não operação homologada em Android.
3. **Backup REAL:** falta extrair em modo leitura, criptografar para chave pública controlada pelo usuário, guardar cópias independentes e comprovar restauração completa (incluindo objetos Storage, RLS, mídia e plano de replay pós-corte), tudo sob autorização separada.
4. **Rollback após compactação:** desativar `enabled` é seguro para interromper NOVAS exclusões, porém não restaura eventos brutos anteriores já eliminados; manter ledger, resumo e relatório híbrido. Não restaurar somente a versão antiga do painel sobre dados já compactados.
5. Supabase de produção sofreu restrição de invocações e egress; recuperar cotas e monitorar volume antes de considerar qualquer rollout. A V30 não corrige automaticamente os limites de rede.
6. É necessária aprovação específica para alterar backend/painel, TV de bancada ou APK, e outra para autorizar compactação de sete dias. **Nenhuma aprovação foi presumida**.

## Critérios finais de GO/NO-GO

- GO apenas se: Auth/JWT/RLS + portal/anunciante validados com dados representativos; Casa em bancada com versão/assinatura verificadas; offline/horário/quiosque/rotação intactos; comprovantes e alertas locais duráveis; backup real cifrado e restauração; rollback descrito e ensaiado; cotas estáveis; e autorização específica da etapa.
- Estado atual: **NO-GO para produção**. O código, as evidências e o ZIP de QA foram preparados na branch sem instalar nada.
