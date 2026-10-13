# Ensaio de captura — checkpoint 12/10/2026

Base preservada: 921f365b7f1ee5c7da7c96b74b3cdf1462e180c3.
Plano remoto: 0b2d44a437012bc52a8726334418baf95548be0d.

Backup de arquivos versionados: Vision-Midia-backup-20261012-921f365.zip,
2673345 bytes, SHA-256 bdbc5e07f3ea51261d6e3723025a22ede1c463710f0dc92992e86d1ed1c4bb9a.
Não inclui banco, Storage ou segredos. Hash conferido na retomada anterior.

O ambiente perdeu o checkout e toolchain temporários em duas retomadas.
Fontes recuperados do registro da execução; prioridade deste checkpoint é persistir
no GitHub em branch isolada antes de nova compilação. Não substituir base existente.

- Política: 22 verificações passaram nesta retomada.
- Tamanho/suporte/liberação: 15 verificações passaram nesta retomada.
- Manifesto: permissões exatas, serviço privado, sem autostart, aprovado.
- Suite existente: 81 testes passaram novamente nesta retomada, zero falhas.
- RED→GREEN foi observado para política, segurança e manifesto na implementação
  anterior registrada na conversa; esta retomada recupera esses mesmos fontes.
- Compilação `assembleDebug lintDebug`: BUILD SUCCESSFUL. Assinatura APK v2 verificada.
  Certificado de depuração Android Debug, RSA 2048; não é a chave do Player.
  Lint: zero erros, seis avisos documentados abaixo.
- Revisão independente do código recuperado: nenhum Critical/Important confirmado.
  Minor adiado: resposta antiga de consentimento pode sobrescrever o texto do estado,
  mas não inicia captura nem altera a política da sessão ativa. Validar em aparelho.
- Teste físico: PENDENTE. Nenhuma TV atualizada, nenhum deploy ou migration.

Ruling: captura exige API29+ para limitar frames; Android antigo recebe explicação.
Custo: aparelhos anteriores ao Android 10 não executam o ensaio, mas o Player atual
não sofre alteração. Ruling: APK debug independente é somente prova local de captura;
não entrega transmissão no painel. Consentimento Android é obrigatório por sessão.

Próximo: instalar voluntariamente em aparelho de ensaio e validar captura, parada
e reprodução. WebRTC, sinalização e painel continuam fora desta etapa.

## Artefato final e validação

APK: `Vision-Live-Ensaio-0.1.0.apk`, pacote `com.visionmidia.liveprobe`, versão 1.
SHA-256: `26cc20cabbbbca9bd653a85bc3dd1ea47f2f0188335000764f1a955e9dfcc37e`.
Certificado SHA-256: `64debf38fbe0894756d65b98ab853da37bd32b972204e155c6c6fbda4a4bdd31`.
`aapt dump badging` e `aapt dump permissions` aprovados: pacote independente,
minSdk24/target35, somente foreground service, mediaProjection e notificações.
Ícone e banner incluídos no APK; launcher de TV declarado opcional.
O lint inicialmente encontrou MissingTvBanner/MissingLeanbackSupport; teste de
manifesto reproduziu a falha e passou após correção. Ícone autocontido também
verificado após falha do teste correspondente. Nenhuma regra lint foi desabilitada.

Avisos de lint mantidos: InlinedApi (constante API29 protegida pelo gate API29 na
Activity e no serviço), VectorRaster (banner do launcher), DataExtractionRules
(sem dados persistidos e allowBackup=false) e três SetTextI18n (ensaio em português).
São limitações de acabamento/declaração para revisar antes de qualquer versão estável.

Testes finais: 81 testes Node passaram, 37 verificações Java passaram, manifesto
validado, git diff --check sem erros. Nenhum aparelho listado por `adb devices`.
Player, PWA e backend sem diff contra a base. Sem merge, deploy ou migration.
A revisão estática não substitui teste de permissões, encoder e callbacks em TV/OEM.
