# Vision — mapa técnico e plano de 300 TVs (30/10/2026)

## Escopo e evidência
Leitura de `player.js` (main), `device-gateway`, `device-monitoring`, estrutura do repositório e amostras de logs Supabase. Os números abaixo são estimativas matemáticas, NÃO medições de carga nem promessa de capacidade. O APK estável pode seguir outro fluxo (`device-bundle-stable`); conferir versão real por dispositivo antes de rollout.

| Fluxo | Origem → destino | Frequência observada no código | 300 TVs / hora, teto teórico | Dependência | Decisão |
|---|---|---|---|---|---|
| Manifest/playlist | player → gateway → banco/mídias | 15 s (main) | 72.000 | Supabase, Storage, cache | CORRIGIR: versionamento/304 e cache |
| Comandos | player → gateway → device_commands | 5 s (main) | 216.000 | Supabase, painel | CORRIGIR: 15 s no piloto, confirmação de comandos |
| Heartbeat | player → monitoramento → devices | 30 s (main) | 36.000 | Supabase | MANTER inicialmente; separar presença de diagnósticos |
| Registros de reprodução | player → fila → playback_logs | lote por heartbeat (main) | variável conforme anúncios | cache, banco, rede | SIMPLIFICAR: batch idempotente e agregação |
| Offline / status | heartbeat → devices / sweeps | limiar 90 s no código de função inspecionado | variável; sweeps antes por heartbeat | banco, notificações | CORRIGIR: separar detecção de notificação após >8 min, validar implementação atual |
| Cache de mídia | player → Cache API | ao sincronizar / mídia nova | variável | WebView, Storage | MANTER: nunca limpar conteúdo válido sem substituto |
| Painel master | master.js → Edge Functions / Supabase | por interação (não medido) | variável | Auth, RLS, banco | MANTER; auditar consultas |
| Acesso e pareamento | APK/player → gateway → credentials/pairing | conforme autenticação | variável | JWT/token, banco | MANTER; não enfraquecer segurança |
| Loterias, notícias, hora certa | player → serviços públicos/cache | não confirmado neste inventário | não estimado | serviços externos | AUDITAR separadamente |
| Push offline | backend → notificações | regra de >8 min relatada; não validada em código | eventos, não polling | monitoramento, push | VERIFICAR antes de alterar |

## Alteração isolada em branch
`perf/player-jitter-300-tvs-20261030`: intervalos do `player.js` de 15s→60s para manifest e 5s→15s para comandos, com atraso inicial aleatório, mantendo sincronização e consulta imediatas no início. Nenhuma publicação de produção. Main permanece rollback integral. Não mexer no limiar offline/alertas sem localizar implementação real.

## Metas e cálculo (não medido)
Apenas manifest + comandos: 288.000/h no main → 90.000/h no piloto (redução teórica 68,75%). Heartbeat inalterado: 36.000/h. Este cálculo NÃO inclui chamadas internas das funções, reintentos, registros de reprodução ou outros clientes. Para 300 TVs, evitar sincronização em fase e limitar carga de banco por ciclo.

## Gates antes de publicar
1. Confirmar qual player/APK e Edge Function cada TV usa (bundle vs gateway/monitoring); código main não prova execução atual.
2. Testes locais: pareamento, boot offline com cache, playlist alterada, comando screenshot/restart, retorno online, acesso bloqueado, hora incorreta, reconexão.
3. Carga isolada 50→100→300 clientes simulados; medir requests/s, p95, erros 429/5xx, CPU, escrita no banco, armazenamento.
4. Piloto uma TV de teste; observar 1h; comparar janelas equivalentes e manter gatilho de rollback para falha de comandos, playlists ou reprodução.
5. Rollback: reverter commit `cc4793266cdc3a3b4a00208df5781e5d5e03959e` ou restaurar `player.js` de main. Não alterar APK ou TVs sem validação.

## Classificação
MANTER: cache offline, reprodução, autenticação por dispositivo, comprovantes de exibição, fila idempotente.
CORRIGIR: chamadas redundantes, varredura de offline, detecção de mudanças no manifest, alertas com histerese.
SIMPLIFICAR: endpoints de leitura agrupados, snapshots/relatórios por dia, diagnósticos por alteração.
SUBSTITUIR SOMENTE SE TESTADO: polling completo de manifest por consulta condicional; nunca substituir o sistema inteiro de uma vez.

## Incertezas
Não foi comprovado que o `player.js` main é o caminho ativo do APK 1.5.24; a função bundle em produção possui sua própria rotina. Não foi localizada nesta revisão a implementação final de notificações de >8 minutos. Índices e retenção de playback_logs requerem análise de uso antes de qualquer alteração destrutiva.
