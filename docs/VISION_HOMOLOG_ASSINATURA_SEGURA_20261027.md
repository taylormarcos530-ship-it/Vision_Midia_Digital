# Vision — assinatura permanente e atualização segura do APK de homologação

**Data:** 27/10/2026. **Escopo:** somente `fix/vision-supabase-free-traffic-isolated-20261027`; não tocar produção, banco, TVs existentes ou backup.

## Descoberta importante: certificados distintos

Extraídos e examinados localmente os dois artefatos reais de GitHub Actions:

| APK | Run | SHA-256 certificado de assinatura |
|--|--|--|
| Primeiro APK, instalado na Lotérica | 40495944167 | `2F8E0D8AF0B2C8E99AACE397563808A9A2D9CEC8E82C89A95C6B516B3B684D53` |
| APK novo de medição, não instalado | 40505991794 | `FA8E72131346FDCA7B04E3E2047E1FE694059BCEF3FA88D01290D13B0188BB59` |

Os dois pacotes são `com.visionmidia.player.homolog`, porém **assinados com chaves diferentes**. Android exige identidade do pacote e assinante compatíveis para atualizar in-place. Não é possível transformar o segundo arquivo em atualização do primeiro sem a **chave privada original**. O runner original GitHub Actions era efêmero; não se presume acesso a essa chave.

**Não desinstalar o APK que está funcionando nem instalar outro sobre ele** para forçar o teste; cache, token e pareamento local não devem ser descartados por acidente.

## Ajustes feitos NA BRANCH, sem aplicação em dispositivos

1. Gradle agora aceita um conjunto completo de variáveis privadas `VISION_QA_KEYSTORE_FILE`, `VISION_QA_KEYSTORE_PASSWORD`, `VISION_QA_KEY_ALIAS` e `VISION_QA_KEY_PASSWORD`, e usa a **mesma keystore** para assinar todas as futuras homologações.
2. `scripts/vision-qa-signing-check.sh` recusa compilações distribuíveis sem credenciais e compara a assinatura gerada com um fingerprint previamente fixado `VISION_QA_EXPECTED_CERT_SHA256`. A identidade Android continua distinta: `com.visionmidia.player.homolog`.
3. `scripts/vision-qa-generate-signing.sh` permite gerar **uma nova chave permanente privada no computador seguro do operador**, jamais no repositório. Recusa sobrescrever uma chave anterior. Usar somente uma vez, em máquina de confiança atualizada; não executar no Windows 8 desatualizado.
4. Workflow CI da branch deixou de publicar APKs temporariamente assinados, que não podem servir de atualização confiável. Compila e testa apenas, sem upload/distribuição.
5. O código do medidor de consultas em `player.js` permanece isolado. Ele é enviado via heartbeat existente e **ainda não foi instalado na Lotérica**.
6. A chave de assinatura do APK é **diferente da chave age usada no backup de banco**. Não reutilizar, não misturar projetos e não compartilhar por chat.

## Estado real e próximo procedimento

- **TV Lotérica:** APK homologação anterior segue instalado, autorizado, reproduzindo e sincronizando; não há mudança local.
- **Para futuras atualizações reproduzíveis:** operador deve controlar permanentemente uma keystore Android e seu segredo, com cópias de recuperação privadas. Perder a keystore equivale a perder capacidade de atualizar aquele mesmo identificador de app.
- **Primeira transição da assinatura temporária atual para a permanente:** inevitavelmente exige uma escolha explícita do proprietário:
  - preservar o aplicativo atual e **instalar um novo identificador Android, pareando uma TV de teste separada**; ou
  - remover a instalação temporária e instalar uma nova assinada com chave fixa **somente na TV de testes**, após salvar dados locais pertinentes, ciente de que será necessário refazer o pareamento e reconstruir cache.
- Não registrar/cancelar TVs, não renovar autorização, não excluir mídia, não executar atualização do APK oficial nem publicar automaticamente.
- Se a prioridade é apenas medir economia, usar o código novo em emulador Android isolado até o operador autorizar uma transição física.

**Situação:** signing reproducível preparado em código, mas **a keystore real ainda não foi criada nem configurada**, e não existe novo APK assinado pronto para instalar sobre o app atualmente ativo. Nenhum resultado dos testes unitários elimina essa limitação do Android.
