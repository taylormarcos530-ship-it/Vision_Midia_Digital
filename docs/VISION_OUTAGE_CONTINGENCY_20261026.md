# Vision Mídia Digital — relatório de contingência isolada (26/10/2026)

## Escopo e preservação

Base exata da produção recuperada: `736f58159de03cda86550472214943e73de5395c`.
Branch isolada: `fix/vision-outage-resilience-isolated-20261026`.
**Não** fazer merge/deploy de produção, executar migrations, substituir APK oficial ou aplicar alterações em TVs. O Android `assembleDebug` no GitHub Actions valida um candidato temporário sem distribuição.

## Incidente: evidências, não suposições

- Vercel servia `index.html`, `master.html`, `app.js`, `master.js` e `config.js` com HTTP 200. A tela de login preta também tinha causa local: inicialização bloqueada esperando a configuração pública, corrigida anteriormente e já presente na base de produção.
- Supabase: Auth `error finding user: context canceled` HTTP 500, Data API 522/504/503, Edge Functions 500/504/546, cron jobs com `startup timeout`, PostgreSQL com timeouts intermitentes. A infraestrutura era `Nano`/Free e exibia aviso de orçamento Disk I/O. A combinação é **compatível com saturação/instabilidade do backend**, sem atribuição conclusiva de causa raiz.
- Houve volume histórico muito elevado de atualizações de credenciais e pareamento. A função `device-gateway` v19 foi otimizada separadamente; não a modificar nesta branch.
- Após o procedimento manual de reinicialização rápida do banco, foram observados HTTP 200 no gateway, respostas HTTP 200 na Auth e dois dispositivos com atividade recente. **Recuperação observada não significa estabilidade contínua**.

## Proteções que já existiam

- APK Android empacota `player.html`, `player.js` e `config.js` e abre via `WebViewAssetLoader` local: falha na Vercel não obriga baixar esses arquivos na partida.
- `vision_player_manifest_v1` em `localStorage`; binários de imagem/vídeo via Cache Storage `vision-player-media-v1`. Não inventar conteúdo sem pareamento.
- Fila de exibições e eventos em armazenamento local e envio posterior.
- `enforceLocalAccess()` verifica expiração local periodicamente; servidor limita a concessão offline a até 24 h ou vencimento anterior, na forma aplicável. Respostas explícitas de bloqueio mantêm ou invalidam a autorização conforme a regra já existente.
- Vinculação pelo `device-bootstrap`, token vinculado ao equipamento e ações remotas de manutenção existentes.

## Alterações realizadas somente nesta branch

1. A inicialização de TV já pareada ativa os timers e o cache antes de aguardar chamadas ao servidor. Falha no primeiro acesso não impede o próximo ciclo.
2. Polling serializado (*single-flight*), evitando tarefas de rede periódicas sobrepostas; retentativas após falha com backoff exponencial limitado a 5 minutos + jitter. Pareamento também recua em falhas repetidas, sem gerar licença ou playlist fictícia.
3. Intervalos de referência em operação normal: comandos 45 s (antes 5 s), programação 120 s (antes 15 s), heartbeat 120 s (antes 30 s).
4. Rejeita manifesto malformado, incompleto, sem validade de acesso ou de TV diferente **antes** de substituir manifesto/autorizações locais. Um `source:'none'` explícito e válido ainda permite desassociação legítima pelo servidor.
5. Quando uma nova playlist contém mídia local, verifica a disponibilidade de sua primeira mídia antes de abandonar a anterior. Cache antigo só é limpo depois que os binários locais da playlist nova foram baixados; arquivos incompletos são tentados novamente em sincronizações futuras.
6. Descarta downloads vazios/respostas HTML incorretas na preparação de mídia. Mantém a fila de comprovantes de exibição e envia em lotes por heartbeat (ou antes de ultrapassar limite de fila).
7. Master mostra “dados anteriores” apenas para conteúdo já carregado na sessão *em memória* após verificação de permissão. Retenta após indisponibilidade em intervalos controlados, revalidando `whoami` **e** e-mail do administrador. Não cria login offline, armazenamento persistente de dados Master ou confirmação falsa de salvamento.

## Estimativa de tráfego por TV

Cálculo apenas de polling normal de uma TV ligada 24 h/dia, sem comandos extras/telemetria/eventos:
- Antes: comandos `86400/5 = 17.280`, manifestos `86400/15 = 5.760`, heartbeats `86400/30 = 2.880`: **25.920 chamadas/dia**.
- Depois: comandos `86400/45 = 1.920`, manifestos `86400/120 = 720`, heartbeats `86400/120 = 720`: **3.360 chamadas/dia**, redução nominal de **87,0%** no polling periódico.
- As chamadas reais variam. Para 33 TVs 24 h, esse polling isolado ainda alcançaria ~3,33 milhões/mês. **A otimização não comprova escalabilidade de 33+ TVs no plano gratuito.** Para aumentar significativamente a capacidade sem custo, precisa projetar endpoint consolidado/event-driven, ETag/versionamento condicional e medição com 10/30/50 TVs.

## Segurança e restrições

- Não alterar autenticação, RLS, bloqueio, versão oficial de APK, rotação, autostart, cadastro de anunciante, planos ou playlist no servidor.
- Relógio do TV Box incorreto: a validação deve falhar de forma segura quando não há referência de tempo confiável. Não é seguro conceder funcionamento offline ilimitado nem aceitar relógio arbitrariamente atrasado. A solução completa exige prova temporal confiável, tolerância delimitada e testes físicos.
- Uma TV recém-instalada não tem cache e deve aguardar pareamento/autorização do servidor: o código de vinculação reaparecer após recuperação é esperado, não significa perda de dados.
- Não migrar o banco ou usar Firebase/Cloudflare como parte do incidente imediato.

## Testes e limitações

Workflow isolado `.github/workflows/vision-outage-resilience-isolated.yml`:
- Sintaxe de `player.js`/`master.js`.
- Testes JS com servidor indisponível, retry single-flight, sessão Master, proteção contra troca de identidade, licença vencida, payload inválido, mídias com download parcial, primeiro pareamento e cache.
- Compilação Android `assembleDebug` em CI sem publicação.
- **Ainda pendente:** homologação física de APK numa única TV de teste, ensaio de instabilidade da Vercel/CDN, stress de 10/30/50 TVs contra ambiente isolado, relógio incorreto em hardware real e medição real após distribuição controlada.
- Uma suíte geral antiga tinha **13 falhas já presentes na base de produção**, comparadas anteriormente com a correção de login; o teste de áudio `player-controls.test.cjs` tem fixture VM incompleta (`document` ausente), então não deve ser interpretado como regressão desta branch.

## Próxima decisão técnica

Apenas após homologação física e autorização explícita: criar APK candidato separado para uma TV de teste, medir recuperação e carga, e somente então planejar distribuição gradual com rollback para a versão estável. Não trocar diretamente os APKs de clientes.
