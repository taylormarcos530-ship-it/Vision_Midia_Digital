# Vision Mídia Digital — redução de carga Supabase Free (isolado, 27/10/2026)

## Objetivo e separação de trabalho

A otimização desta branch é **independente** do projeto de backup na branch `fix/vision-backup-foundation-isolated-20261026`. É derivada da branch previamente homologada em CI `fix/vision-outage-resilience-isolated-20261026` e da base de produção recuperada `736f58159de03cda86550472214943e73de5395c`.

**Nenhuma alteração desta branch foi implantada em Vercel/Supabase. Nenhum APK foi distribuído ou instalado.** A branch do backup, Drive, dump, scripts de exportação, chaves e PostgreSQL real não são tocados nesta etapa.

## Medições de produção, somente leitura

Medições em consulta de registros das últimas 24 h do projeto `fpadgedrgcxrrqflzhjt`:

- `device-gateway`: aproximadamente **61.761 eventos de requisição** nos logs.
- `device-monitoring`: aproximadamente **4.940 eventos de requisição**.
- `devices`: **34 registros históricos**, **2 com `last_seen_at` nos últimos 15 min**.
- O total de eventos de requisição obtidos de logs não corresponde necessariamente a invocações faturáveis; conferir a contagem oficial no Supabase **Usage → Edge Function Invocations** e o ciclo mensal antes de afirmar suspensão ou cobrança.
- Dados históricos e activity 15min não provam que somente duas TVs chamaram APIs em toda janela.
- O principal tráfego vem de `device-gateway`, compatível com o polling muito frequente ainda presente nos Players atualmente instalados; não atribuir 100% do tráfego sem instrumentação por ação.

## Pacote de resiliência herdado da branch anterior

- Comandos a cada 45 s (antes 5 s), manifesto a cada 120 s (antes 15 s), heartbeat a cada 120 s (antes 30 s).
- Retentativas exponenciais e single-flight para tarefas periódicas; cache pré-carregado antes de trocar mídias; manifesto validado antes de alterar playlist/autorizações; vencimento local testado a cada segundo.
- Fila de eventos e comprovantes de reprodução enviada em lotes. O Player que ainda roda em produção **não** foi modificado.

## Melhorias desta etapa

1. **Uploads single-flight de comprovantes de reprodução**: chamadas concorrentes ao `playback_batch` usam uma mesma operação de envio, evitando envios duplicados.
2. **Fila preservada durante envios**: remove do armazenamento apenas os IDs efetivamente confirmados pelo servidor; novos eventos registrados enquanto o POST estava pendente são preservados. Erro HTTP conserva registros para tentativa posterior.
3. **Single-flight de notificações/diagnósticos** para `device-monitoring event_batch`, com mesmas garantias de não descartar eventos novos ou não confirmados.
4. **Jitter de ±15% nos timers periódicos**, por TV e por canal, evitando que as TVs reiniciadas simultaneamente enviem rajadas perfeitamente sincronizadas. Tempo de resposta a comando remoto permanece aproximadamente 38–52 s por ciclo e pode ser maior em caso de falha.
5. **Estimador offline de capacidade** em `scripts/vision-supabase-free-budget.cjs`, lendo os intervalos reais do `player.js`. Pode ser executado localmente com `node scripts/vision-supabase-free-budget.cjs 2`. Não conecta ao Supabase nem gera custos.

## Contas de capacidade (estimativas, não consumo real)

Somente polling nominal de um aparelho ligado 24h/dia, sem fila extra, pareamento, dashboard ou outras funções:

| Player | Comandos/dia | Manifesto/dia | Heartbeat/dia | Total |
| --- | ---: | ---: | ---: | ---: |
| Produção anterior | 17.280 | 5.760 | 2.880 | 25.920 |
| Candidato em branch | 1.920 | 720 | 720 | 3.360 |

Redução matemática nominal: **87%** do polling periódico comparado ao Player anterior, mas **não** é uma medição comprovada das TVs em campo.

| TVs sempre online | Estimativa mês de 30 dias (só polling) | Interpretação em relação a 500 mil/mês |
| ---: | ---: | --- |
| 2 | 201.600 | Dentro da franquia nominal, com espaço para outras funções |
| 3 | 302.400 | Possível, mas medir chamadas adicionais |
| 4 | 403.200 | Próximo ao limite sem folga recomendada |
| 5 | 504.000 | Acima da franquia apenas com polling |
| 10 | 1.008.000 | Precisa redesenhar |
| 33 | 3.326.400 | Precisa redesenhar |
| 50 | 5.040.000 | Precisa redesenhar |

O cálculo assume cenário hipotético de TVs continuamente online. **34 dispositivos cadastrados não equivalem a 34 TVs simultaneamente ligadas.** A quantidade de invocações faturáveis precisa ser confirmada no dashboard, não inferida somente dos logs.

## Antes de instalar mais TVs: próximo nível de arquitetura

O próximo grande ganho requer um **endpoint de status consolidado e seguro** (comandos, lease/autorização, alteração de programação, resumo de telemetria numa única invocação) e atualização somente quando a revisão muda, com renovação criptograficamente válida da licença. Hoje o `device-gateway` ainda monta playlists e assina URLs na ação `manifest`; consultá-lo para obter a mesma programação repetidamente desperdiça processamento. Comandos urgentes podem exigir mecanismo de notificação autenticado separado, com polling de segurança em intervalos maiores.

Isso requer evolução do backend com testes de autenticação, RLS, limites, pagamento, cache, compatibilidade com APKs antigos e rollback. **Não alterar a Edge Function v19 em produção nem ativar este desenho sem aprovação e ensaio de compatibilidade.**

## Critérios de liberação futura

- CI verde e APK debug compilado, **não distribuído**.
- Teste físico numa única TV, sem interromper as demais. Instalação de APK candidato somente após autorização específica.
- Medir invocações por ação e comparar 24h antes/depois, tempo de controle remoto e relatórios de reprodução, estado offline e expiração.
- Verificar que operações do Master, anúncios, uploads, cache, licença e notificações continuam íntegras.
- Fazer a primeira cópia de segurança real e a restauração sob o fluxo independente de backup; não usar a atividade de backup como parte deste deploy.
- Expandir somente depois de teste e autorização explícita.

## Limitações

- Melhorias na branch não reduzem a conta de invocações **até serem autorizadas, compiladas, instaladas e verificadas** nos dispositivos que realmente executam o Player.
- A quota Free de invocações é por período de cobrança e pode mudar; confiar nos valores exibidos no plano real em `Usage`.
- Jitter distribui picos, não reduz o número médio de consultas.
- A confirmação de evento feita pelo gateway é a fonte de verdade; a fila só é removida após resposta bem-sucedida. Os IDs já são usados para deduplicar a ingestão no backend, mas o teste físico ainda é necessário.
