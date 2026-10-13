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
- Suite existente: 81 testes passaram na retomada anterior; repetir antes de concluir.
- RED→GREEN foi observado para política, segurança e manifesto na implementação
  anterior registrada na conversa; esta retomada recupera esses mesmos fontes.
- Compilação, lint e assinatura: PENDENTES. Não há APK novo validado neste checkpoint.
- Revisão do código recuperado: aguardando resultado.
- Teste físico: PENDENTE. Nenhuma TV atualizada, nenhum deploy ou migration.

Ruling: captura exige API29+ para limitar frames; Android antigo recebe explicação.
Custo: aparelhos anteriores ao Android 10 não executam o ensaio, mas o Player atual
não sofre alteração. Ruling: APK debug independente é somente prova local de captura;
não entrega transmissão no painel. Consentimento Android é obrigatório por sessão.

Próximo: concluir revisão, assembleDebug/lintDebug, conferir assinatura e manifesto
final, entregar APK de ensaio. Depois validar numa TV Box antes de WebRTC/backend.
