# VISION MÍDIA DIGITAL — Primeira cópia REAL: plano de execução sem interrupção

## Estado do trabalho

- **A pasta Google Drive existe e foi verificada como privada:** `01 - BACKUPS CRIPTOGRAFADOS`, em `visionmidiadigital2@gmail.com`.
- Volume estimado por consulta de leitura: `167,996,563` bytes de banco, `301,853,195` bytes de Storage (79 itens), total lógico/armazenado ~470 MB **antes** de compactação. O arquivo final terá tamanho diferente.
- O backup e a restauração foram testados apenas com **dados fictícios** em PostgreSQL 17.11, num pipeline isolado; nenhuma cópia real foi produzida.
- Não existem credenciais de exportação acessíveis através da integração Supabase desta conversa. **Não afirmar que dados reais estão copiados.**
- O repositório do aplicativo continua **público** e NÃO é um destino seguro para dumps, tokens, mídias ou credenciais. Não habilitar backups reais em GitHub Actions público nem publicar artifacts com dados reais.
- Não há alterações permitidas em tabelas, Edge Functions, produção Vercel, APKs e TVs.

## Risco: chave privada

1. Gerar um par X25519 `age` no ambiente seguro **controlado pelo proprietário**: `age-keygen -o vision-recovery.key`.
2. Preservar **duas cópias da chave privada** em lugares seguros separados e offline, e testar que consegue ler ambas. Chave privada nunca deve ser compartilhada no chat, enviada para GitHub, colocada na pasta com backups ou entregue ao job diário.
3. **Somente a chave pública** `age1...` entra como `VISION_BACKUP_AGE_RECIPIENT` no job de exportação.
4. Se a chave privada for perdida, os backups cifrados NÃO podem ser restaurados. Se a chave privada vazar, rotacionar e recriptografar todas as cópias anteriores que se pretende conservar.

## Pré-condições obrigatórias para um backup real

- Operador conectado num ambiente Linux privado e atualizado (não Windows 8 sem atualizações de segurança), com ferramentas: PostgreSQL 17 clientes, Python 3.11+, age e espaço livre superior ao tamanho esperado do backup **sem criptografia**.
- Chave pública previamente configurada, chave privada fora do ambiente remoto e já guardada.
- Acesso ao banco **somente para exportação** e chave da API Storage com leitura. O script atual requer um segredo `service_role` de alta permissão para listar/baixar mídias; isto exige isolamento rigoroso da execução. Evitar logs detalhados e scripts de terceiros.
- Não usar o projeto GitHub público como executor das credenciais de produção. Em fase posterior considerar runner protegido em ambiente privado ou repositório dedicado privado, com aprovação.
- Confirmar janela de baixo movimento, consumo de disco no Supabase Nano, espaço Google Drive e ausência de problemas ativos.
- Configurar `VISION_BACKUP_DATABASE_URL`, `VISION_BACKUP_SUPABASE_URL`, `VISION_BACKUP_SERVICE_ROLE_KEY`, `VISION_BACKUP_AGE_RECIPIENT` **dentro do cofre de segredos do executor**, não em texto, chat, git, screenshot ou argumentos de linha de comando.
- O código `scripts/vision-backup/backup.py` é **somente leitura** sobre o banco e o Storage. Ler/baixar dados reais **não altera registros**, mas utiliza CPU, rede e I/O; não sobrecarregar.

## Execução controlada, somente quando as pré-condições estiverem satisfeitas

1. `python3 scripts/vision-backup/backup.py --check`
2. `python3 scripts/vision-backup/backup.py --output /LOCAL-PRIVADO/vision-AAAAMMDD-HHMM.tar.gz.age`
3. Não declarar sucesso se o comando não terminar com `Encrypted backup created locally`.
4. Guardar somente o arquivo cifrado `.age` na pasta privada do Drive. Não publicar em `Actions/artifacts`, `releases`, `commit` ou URL pública.
5. Com a chave privada **no local seguro do proprietário**, rodar o verificador `python3 scripts/vision-backup/verify.py --backup /CAMINHO/vision-...age --identity /CAMINHO/vision-recovery.key` em computador de confiança. Resultado esperado `status: PASS`.
6. Verificação `PASS` do manifesto não comprova restauração completa. Descriptografar e restaurar num PostgreSQL isolado sob controle do proprietário, conferir RLS, contas, políticas, playlists, contagens, arquivos e rotas do aplicativo. Não restaurar sobre produção.

## Retenção e automação (ainda não habilitadas)

Inicialmente, avaliar 7 cópias diárias + 4 semanais + 3 mensais. **Não** apagar automaticamente os arquivos até provar que ao menos uma cadeia de restauração funciona. Não criar cron de backup automático enquanto não houver primeiro backup real íntegro e não houver monitoramento do plano Free.
Uma estimativa ingênua de 14 cópias completas × ~470 MB = ~6,6 GB, sem considerar compactação, crescimento ou uso pré-existente do Drive. Conferir espaço real antes de escolher a retenção.
Nunca excluir o último backup conhecido bom por causa de uma cópia incompleta.

## Bloqueios restantes

**PENDENTE:** chave privada do proprietário e chave pública `age1...`; credenciais de exportação fornecidas ao executor privado; ligação segura com Google Drive; execução real e restauração independente. A integração nesta conversa não dispõe de `pg_dump` nem das credenciais do banco ou Storage para efetuar a cópia real.

**Conclusão até aqui:** armazenador privado + ferramentas testadas e corrigidas; **backup real ainda não existe**.
