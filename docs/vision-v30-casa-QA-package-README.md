# Vision V30 — Pacote de homologação para a TV Box Casa

**Somente documentação, código-fonte e testes. Não contém APK, instalador, credenciais ou backup real.**

Branch: `fix/playback-daily-retention-safe-20261030`.
Objetivo: preparar a próxima validação em **ambiente de bancada** sem alterar TV Box, Supabase de produção, Vercel ou dados reais.

## Conteúdo do ZIP

- `README-CASA.md` — este documento
- `CHECKLIST-CASA.md` — procedimentos e critérios PASS/FAIL
- `ROTEIRO-ROLLBACK.md` — diretrizes de recuperação e congelamento da compactação
- `player-v30-QA.js` — **cópia de fonte para revisão**, NÃO é executável para instalação em APK
- `device-gateway-v30-QA.ts` — **cópia da função da branch de testes**, NÃO publicar isoladamente
- `v30-playback-quarantine.test.cjs`, `v30-playback-storage-quota.test.cjs` — testes locais
- `v30-gateway-v22-parity.test.cjs` — verificação de que funções fora de playback permanecem idênticas à v22
- `MANIFEST.txt` e `SHA256SUMS.txt` — commit, identificação e hashes dos arquivos

## Restrições operacionais

1. NÃO instalar, parear/desparear, atualizar ou reiniciar a TV Box Casa com este pacote.
2. NÃO usar credencial real de Supabase, token de produção, senha, chave privada age ou mídia de clientes.
3. Os testes de bancada futuros deverão usar um **dispositivo de testes isolado**, imagens sintéticas e backend local.
4. Não compilar nem distribuir APK nesta etapa. Versão 1.5.24 permanece inalterada.
5. Compactação e deleção em produção continuam **desativadas**. A retenção de 7 dias existe só como política proposta.
6. O ZIP não substitui backup cifrado e restauração de produção nem torna o localStorage infinito.

## PASS/FAIL obrigatório antes de instalação futura

Conforme CHECKLIST-CASA.md, confirmar versionCode, package, assinatura, cache offline, auto-start, quiosque, relógio incorreto, reproduções por anunciante/TV, reenvios duplicados, perda de ACK, espaço insuficiente e rota de rollback **sem perder dados locais**.

## Download

O ZIP de QA é gerado apenas pela execução isolada do GitHub Actions. Os arquivos são rotulados com o commit exato de origem; o usuário deve comparar o SHA-256 do ZIP com `vision-v30-casa-QA.zip.sha256`. Nenhum arquivo de backup sintético ou chave de criptografia é incluído no pacote.
