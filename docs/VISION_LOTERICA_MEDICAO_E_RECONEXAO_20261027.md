# Medição de tráfego e prova de reprodução — TV Teste Lotérica (27/10/2026)

## Medições realizadas (somente leitura)

Projeto Supabase: `fpadgedrgcxrrqflzhjt`; nenhuma alteração em produção nem no sistema de backup.

**TV "Teste", conta "Lotérica Jaiara"**
- APK 1.5.12-homologacao separado do oficial, Player web vision-player-web-1.5.11.
- Conectou automaticamente após aproximadamente 3 minutos depois de o Wi-Fi retornar. Antes disso, continuou tocando conteúdo em cache enquanto offline. Teste manual do operador; não comprova tempo offline indefinido.
- Estado confirmado por SQL por volta de 12:35 UTC: online, acesso ativo, playlist vinculada, 2 mídias em cache totalizando 132.414 bytes.
- Registros de reprodução: 60 (12:33 UTC) → **72 (12:35 UTC)**, **72 identificadores únicos**; zero duplicados no conjunto inspecionado.
- Exibições no banco chegaram em lotes: 3 às 12:23, 35 às 12:29, 11 às 12:31, 11 às 12:33, 12 às 12:35 UTC. A fila informada pelo heartbeat oscilou (0,2,34,12) porque os contadores são amostrados e a reprodução prossegue entre confirmações de lote.
- `device_monitoring` / `device_heartbeats` armazena apenas amostras de heartbeat a cada aproximadamente cinco minutos e em alterações especiais. **Quantidade de linhas de heartbeat NÃO representa número real de invocações.**

**Visão da frota, não da TV isolada**
- Cinco TVs com contato nos últimos 20 minutos durante a amostra: três vinculadas à Academia Life (APK 1.5.20-stable), uma Casa de carne (APK 1.5.10-stable), e a Lotérica (APK 1.5.12-homologacao). Quatro TVs continuam no APK oficial e não receberam essa otimização.
- `device-gateway` registrou na frota inteira:
  - **11:20–11:35 UTC**: 519 + 513 + 507 = **1.539 POST** (3 intervalos completos de cinco minutos).
  - **12:20–12:35 UTC**: 520 + 517 + 516 = **1.553 POST** (3 intervalos completos de cinco minutos).
  - Variação agregada ~**+0,91%**, em janelas diferentes com usuários, dispositivos e cargas variáveis; essa comparação **não permite estimar o ganho da Lotérica**, mas demonstra que o gasto geral **ainda não caiu**.
- O fluxo elevado é consistente com aparelhos oficiais ainda conectados que consultam a função com intervalos curtos; a causa exata por aparelho/ação ainda precisa de instrumentação.
- Totais de log são solicitações observadas, **não** o número oficial de invocações cobradas. Conferir `Usage → Edge Function Invocations` no painel Supabase.

## Instrumentação preparada NA BRANCH DE TESTE (não instalada)

Foi incluído no `player.js` da branch isolada `fix/vision-supabase-free-traffic-isolated-20261027` um medidor cliente de tentativas por rota/ação, por exemplo:
- `device-gateway.manifest`, `device-gateway.commands`, `device-gateway.playback_batch`;
- `device-monitoring.heartbeat`, `device-monitoring.event_batch`.

O contador é cumulativo, sem conteúdo de mídia, senha, identidade ou dados pessoais, persistido apenas no armazenamento privado do aplicativo e **enviado como `details.request_metrics` no heartbeat já existente**. Não gera novas requisições nem exige alteração da Edge Function. O servidor grava o `details` em amostras de `device_heartbeats` a cada ~5min, permitindo comparar diferenças entre amostras sucessivas.

É um contador de **tentativas iniciadas pelo Player**, incluindo requisições potencialmente falhadas antes de chegar ao servidor. Portanto, a métrica não é equivalência exata da cobrança real. Não inclui tráfego não originado pelo Player ou outros serviços, e os contadores são zerados caso haja novo pareamento local.

## Homologação e segurança de distribuição

O APK instalado pelo operador foi testado com sucesso para reprodução, cache e reconexão, porém **não contém a nova instrumentação** adicionada depois do teste físico.

Uma nova compilação `assembleHomolog` com instrumentação é executada somente na CI, **não é instalada automaticamente** e não substitui as TVs oficiais. Antes de oferecer atualização, verificar assinatura Android: a assinatura debug efêmera gerada em runners distintos pode impedir atualização `in-place`. Não desinstalar a TV de teste nem perder o pareamento apenas para atualizar o medidor sem autorização.

## Próximas decisões

1. Concluir a cópia de segurança real e sua verificação no trabalho de backup independente.
2. Somente com autorização separada, instalar uma versão nova de homologação na TV de teste e verificar `details.request_metrics` de amostras consecutivas; preservar cadastro, playlist, contagens e cache sempre que possível.
3. Medir por TV: diferença acumulada por ação / minutos online, comparando as requisições efetivas no Supabase Usage. Coletar antes/depois em janelas consistentes e documentar.
4. Manter os quatro players oficiais intactos até haver aprovação de recuperação/rollback e teste físico concluído.
5. Para escalar mais que poucas TVs no Free, desenhar um endpoint unificado de controle, leases autenticadas e maior intervalo de polling; não instalar novo backend sem QA e autorização.

**STATUS:** TV homologada manualmente para offline/reconexão, fila progredindo, medição da frota confirmada alta; economia **real por TV ainda não mensurada**.
