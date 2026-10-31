# Vision V30 — homologação nativa Supabase local e recuperação da fila (31/10/2026)

**Resultado:** os testes de Supabase local e quarentena da fila foram aprovados, **somente na branch isolada** `fix/playback-daily-retention-safe-20261030`. Não houve deploy, migração, SQL de escrita ou chamada de reprodução no Supabase oficial; não houve publicação Vercel, compilação de APK, alteração de TVs nem exclusão de eventos reais.

## 1. Execuções reais e reproduzíveis

- **Supabase local nativo** (GitHub Actions): https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41203827730 — **SUCCESS** no commit `c24e4286071807e4dd0d5d16d440b873fa4cc3ff`.
- **Quarentena e recuperação do Player** (GitHub Actions): https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41204231146 — **SUCCESS**, 8/8 testes no commit `27cd8a8be2760e919f58cbf2b929926677094466`.
- Workflow local: `.github/workflows/playback-v30-native-supabase-local.yml`; cria diretório temporário não vinculado, executa `supabase start` somente com Auth/PostgREST/Kong/Edge/Postgres e depois `supabase stop --no-backup`. O CLI foi fixado em 2.84.2; SDK de teste em `@supabase/supabase-js@2.75.0`.
- Arquivos: `tests/v30-native-supabase-e2e.cjs`, `tests/v30-native-supabase-rls.sql`, `tests/v30-playback-quarantine.test.cjs` e `player.js` modificado **apenas na branch**.
- As execuções iniciais deste workflow foram corrigidas apenas em QA: duplicação de empresas sintéticas, expectativa de 0 linhas para `anon` (o bloqueio real foi erro de permissão) e contagem de compactação por múltiplas chamadas para TVs distintas. O run indicado acima passou integralmente.

## 2. O que foi comprovado na pilha NATIVA

A execução usou **Deno Edge Function real e SDK Supabase/PostgREST**, não o adaptador PostgREST simulado do ensaio anterior. Um **Supabase Auth (GoTrue) local** emitiu dois JWTs de usuário autenticado, criados por `auth.admin.createUser` e `signInWithPassword`. As credenciais/token hash de TV foram geradas exclusivamente dentro do runner.

Logs confirmaram:
- `PASS_LOCAL_SUPABASE_LOCAL_AUTH`: dois usuários locais com JWT válido.
- `PASS_LOCAL_SUPABASE_DEVICE_AUTH_INVALID`: token da TV desconhecido recebe HTTP 401.
- `PASS_LOCAL_SUPABASE_DEVICE_AUTH_REVOKED`: credencial revogada recebe HTTP 401.
- `PASS_LOCAL_SUPABASE_SUSPENDED_COMPANY`: empresa bloqueada recebe HTTP 403.
- `PASS_LOCAL_SUPABASE_IDEMPOTENT_ACK`: 2 reproduções novas, reenvio de 2 sem duplicar e tentativa de adulterar `company_id/device_id` do corpo ignorada em favor da TV autenticada.
- `PASS_LOCAL_SUPABASE_INVALID_BATCH`: lote com item inválido recebe HTTP 400 e não grava parcialmente.
- `PASS_LOCAL_SUPABASE_TWO_TV_IDENTITIES`: mesmo `client_event_id` em duas TVs diferentes permanece associado corretamente a cada TV.
- `PASS_LOCAL_SUPABASE_JWT_RLS_RAW`: empresa A recebeu 2 registros, empresa B 1; `anon` não teve acesso.
- `PASS_LOCAL_SUPABASE_JWT_RLS_REPORTS`: relatório A=2, B=1, empresa A recebeu erro ao solicitar relatório B.
- `PASS_LOCAL_SUPABASE_ARCHIVED_JWT_REPORTS`: após compactar **três eventos sintéticos em múltiplos lotes** os resumos retornaram A=2, B=1, sem atravessar empresas.
- `PASS_LOCAL_SUPABASE_ARCHIVED_REPLAY_HTTP`: repetição do evento arquivado recebe ACK HTTP 200, zero nova linha no banco, resumo continua correto.
- `PASS_LOCAL_SUPABASE_COMPLETED`: GoTrue/JWT, SDK, PostgREST e Deno locais.

**Limite da evidência:** estes JWTs são legítimos para o Auth **local** recém-criado, não são sessões de usuários reais da Vision. As tabelas e políticas RLS da aplicação foram reproduzidas de modo sintético, de propósito. Isso não substitui uma revisão de compatibilidade com toda a RLS e permissões do projeto hospedado; a produção não foi acessada para SQL.

## 3. Comparação read-only com a versão 22 implantada

A recuperação por ferramenta de gerenciamento, **apenas leitura**, confirmou `device-gateway` v22 implantado com `ezbr_sha256=80818c961a873df1e1953242fb92d2f5e793b2b064590bf88877586d91ce3031`.

- v22: `String(...client_event_id...).slice(0,120)` pode **truncar ID** e `continue` descarta entrada inválida dentro de lote; o `Player` antigo confirma a fila inteira se a requisição retorna sucesso.
- V30 isolada: rejeição HTTP 400 do lote todo quando qualquer ID é inválido/longo ou data inválida; não confirma nenhum comprovante parcialmente; mantém a opção `onConflict:'device_id,client_event_id',ignoreDuplicates:true` no backend.
- A regra de segurança mantém autenticação própria do dispositivo por `x-device-token`. O gateway implantado está com `verify_jwt=false`; ele **não** substitui a RLS/JWT do painel.
- Nenhuma versão foi implantada ou alterada em produção por esta investigação.

## 4. Quarentena de comprovantes no Player (somente branch)

O código `player.js` na branch introduz `vision_player_playback_quarantine_v30` para guardar:
1. comprovantes permanentemente inválidos com payload integral e motivo (ID ausente/longo, horários inválidos);
2. comprovantes que ultrapassariam a fila ativa de 2.000 eventos;
3. cópia do payload original **mesmo após recuperação manual** de um evento corrigido, com campo de auditoria `recovered_at`.

Os eventos inválidos saem da fila ativa **somente depois** de gravados na quarentena local. Uma falha no armazenamento interrompe a operação em vez de descartar silenciosamente o item original já persistido. Não gera chamadas adicionais ao backend. A rotina de recuperação `recoverQuarantinedPlaybackEvent(index, correctedEvent)` é um recurso **interno de homologação**, ainda sem interface Master para o operador.

Execução 41204231146: 8/8 aprovados:
- lote misto: somente válido enviado, inválido preservado;
- estouro de 2.000: item mais antigo preservado em quarentena;
- falha ao salvar quarentena: fila antiga mantida, sem envio;
- falha de conexão: válido pendente, inválido preservado;
- datas inválidas separadas, nenhum envio indevido;
- offline: não envia nem remove;
- recuperação manual: original auditável, corrigido recolocado e transmitido;
- correção ainda inválida recusada, original preservado.

**Limitações importantes:** `localStorage` tem capacidade finita; a quarentena não é backup fora da TV. Falhas físicas ou esgotamento total do armazenamento podem impedir novos registros. Não afirmar durabilidade ilimitada; avaliar armazenamento Android/IndexedDB ou exportação segura de diagnóstico em bancada. Como `player.js` da branch foi alterado, disponibilizar esse recurso às TVs exigiria uma atualização do player cliente em etapa posterior, talvez nova distribuição de APK conforme a forma como o aplicativo carrega o JavaScript. Não foi feita nenhuma atualização agora.

## 5. Bloqueadores antes de produção

- Validar credenciais e RLS **das tabelas reais** com uma cópia anonimizada, sem executar SQL real de escrita.
- Conferir eventuais diferenças entre branch V30 e gateway v22 para heartbeat, pareamento, playlist, comandos e push além de `playback_batch`.
- Testar a nova fila em TV Box de bancada e simular falta prolongada de armazenamento (com backup/exportação dos comprovantes), antes de publicar o player.
- Revisar custo de armazenamento da quarentena e dos 7 dias de histórico, inclusive limite de invocações e egress **separados** do tamanho do banco.
- Criar backup **real** cifrado e comprovar restauração em ambiente independente antes de autorizar compactação de qualquer dado real.
- A compactação segue desligada por padrão. Não programar cron nem executar DELETE até autorização separada e critérios de paridade/rollback concluídos.

**Decisão:** homologação local nativa e quarentena aprovadas. **Publicação e limpeza ainda bloqueadas**, conforme orientação do usuário.
