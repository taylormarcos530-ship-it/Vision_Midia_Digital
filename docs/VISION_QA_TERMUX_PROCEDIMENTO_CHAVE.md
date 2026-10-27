# Vision — criar a chave permanente do APK de teste no Termux

Esta etapa deve ser executada **no Android do proprietário**, não no runner GitHub, no Work ou no notebook Windows 8 sem atualizações. O comando gera a chave privada **apenas dentro do armazenamento privado do Termux**.

## Antes de começar

- Usar Termux de fonte confiável e atualizado, com espaço livre para OpenJDK 17.
- A TV e os dispositivos que já exibem anúncios permanecem intactos. **Nenhum APK é instalado nesta etapa.**
- Escolher uma senha forte e exclusiva. Ela será digitada **somente no Termux**, não no chat, nos comandos, em screenshots ou no GitHub.
- **Nunca** gerar uma chave se já houver uma chave definitiva guardada em outro lugar: isto criaria uma assinatura incompatível.

## Executar uma vez no Termux

Primeiro, instalar o JDK:

```bash
pkg update
pkg install openjdk-17 curl
```

Depois, baixar a versão **fixada em commit** do script público (não contém credenciais):

```bash
curl -fLSs 'https://raw.githubusercontent.com/taylormarcos530-ship-it/Vision_Midia_Digital/0deab28fb2df4cedad017ba6cb174c5be6535542/scripts/vision-qa-generate-signing.sh' -o "$HOME/vision-qa-generate-signing.sh"
```

Inspecionar o script antes de executá-lo:

```bash
cat "$HOME/vision-qa-generate-signing.sh"
```

Executar:

```bash
bash "$HOME/vision-qa-generate-signing.sh"
```

O `keytool` solicitará a senha da nova chave e a confirmação. Enquanto digita, os caracteres podem não aparecer na tela; isso é esperado.

Se o script informar que a chave já existe, **não apague o arquivo nem force substituição**.

## Arquivo gerado

```text
~/vision-qa-signing/vision-qa-homolog.p12
```

É um arquivo **PRIVADO** de assinatura Android, diferente da chave `age` usada na recuperação do banco. Nunca enviá-lo ao chat ou ao GitHub, e não copiá-lo em claro para armazenamento compartilhado.

Para conferir apenas as permissões, sem imprimir o segredo:

```bash
ls -l "$HOME/vision-qa-signing/vision-qa-homolog.p12"
```

Para obter o **fingerprint público** que será fixado para a assinatura dos próximos APKs, usar quando necessário:

```bash
keytool -list -v -keystore "$HOME/vision-qa-signing/vision-qa-homolog.p12" -alias vision_qa_homolog
```

Não enviar prints com senhas ou material privado. Somente o campo `SHA256` do certificado é público.

## Ainda falta antes de assinar e distribuir APKs

- Fazer **duas cópias de recuperação criptografadas** da chave `.p12`, em locais diferentes, e testar recuperação. Não enviar a chave sem criptografia para o Drive nem para o repositório.
- Escolher um executor confiável e privado onde o proprietário possa colocar a chave, com as variáveis já previstas em `android-player/app/build.gradle`.
- Comparar o SHA-256 do certificado da keystore com o APK gerado e verificar que o pacote é `com.visionmidia.player.homolog`.
- Esta nova chave não coincide com a assinatura temporária do APK da TV de teste. **Não usar como atualização** do APK instalado. A primeira transição exigirá procedimento presencial e autorização específica para não perder pareamento/cache.
- O aplicativo de produção, os demais dispositivos, as tabelas Supabase e o projeto de backup **não devem ser alterados** por esta etapa.

## Identidade pública da chave real (informada pelo proprietário em 27/10/2026)

Fingerprint SHA-256 do certificado X.509 exportado em DER (com `keytool -exportcert -storetype PKCS12`, `sha256sum`):

```text
c26963f76db0bae64c388939ecd0dc81eadd1433a2f098f600d08e362a7bb6c6
```

Este digest público identifica o certificado destinado **somente ao APK `com.visionmidia.player.homolog`**. A verificação do build local (`scripts/vision-qa-signing-check.sh`) requer `VISION_QA_EXPECTED_CERT_SHA256` com esse valor exato e comparação com o certificado do APK assinado. Não alterar ou regenerar a chave privada para atualizações subsequentes.

**Status informado pelo proprietário:** chave privada criada no Termux; backup `vision-qa-segura.age` recuperado em teste e cópias criptografadas no pendrive e notebook verificadas por SHA-256. Esses resultados foram reportados pelo proprietário, **não auditados diretamente pelo repositório**. A chave privada, senhas e backups cifrados não foram enviados ao GitHub.

**Pendente:** montar um ambiente privado de compilação adequado, assinar um APK de teste com a chave definitiva, verificar fingerprint/pacote e preparar transição presencial do APK antigo **somente após autorização explícita**. Nenhum APK foi assinado com esta identidade nesta etapa; sem publicação e sem mudanças de produção.
