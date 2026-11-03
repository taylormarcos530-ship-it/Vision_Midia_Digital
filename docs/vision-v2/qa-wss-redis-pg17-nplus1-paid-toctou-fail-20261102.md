# Vision V2 — WSS com TLS, Redis, PG17, escala paga e TOCTOU

Data do ensaio: 02/11/2026 (logs UTC atravessaram 03/11). Branch exclusiva: experiment/vision-v2-sequence-watermark-qa-20261031. **Base inicial preservada:** 5362ca86eab8e955e581c3624a4c4200996f776c. **Código experimental testado antes deste relatório:** efa9797e648e9fd41304f9e5ef1d70b676630d19.

**VEREDITO: WSS ISOLADO PASS, REGRESSÃO COMERCIAL PASS, SEGURANÇA TOCTOU FAIL, PRODUÇÃO NO-GO.** QA_STREAM_GUARD_GROUP=1, drain desativado. Não houve conexão ou alteração em Supabase oficial, APK, TV, painel/site, Vercel, dados reais ou main.

## Execuções reais e artefatos no GitHub Actions

1. [WSS Redis TLS PostgreSQL17 — run 41556602776](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41556602776): **4/4 jobs PASS**. 100/300/600/1000 conexões WebSocket TLS reais, respectivamente 2/3/5/7 processos OS, Redis7.4 e PostgreSQL17 em containers descartáveis. Inclui o último teste anti-replay de JWT JTI. Artefatos JSON/log por escala.
2. [TOCTOU negativo PG17 — run 41556405244](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41556405244): **2/2 jobs QA PASS reproduzindo o FAIL de segurança** do gate/rota antigo. Pool 8, chunk 64KiB e pool 12, chunk 256KiB. Evidência real: gate fechado e COMMIT antes da liberação do GET, porém HTTP 200 indevido. security_verdict=FAIL_NO_GO; não interpretar verde do job como aprovação de segurança.
3. [Orçamento Free/Pro e relatório cifrado — run 41557038325](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41557038325): **3/3 jobs PASS**, Node 20 e 22 **46/46 testes por versão**, PostgreSQL17 recuperando 10.090 comprovantes AES-GCM com 40 filtros e 200 agrupamentos comerciais idênticos.
4. [Regressão anterior preservada — run 41537195814](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41537195814): 7/7 PASS. Scripts e artefatos anteriores preservados.

## Prova WSS local e fronteiras de segurança

O WSS é real, com TLS e certificado efêmero autogerado/trust local no CI, JWT sintético HMAC-SHA256 por TV e empresa com emissor/audiência/validade, e armazenamento atômico Redis de JTI já utilizado, evitando que o mesmo token seja aceito duas vezes na bancada. A conexão recebe nonce e identificador aleatórios; solicitações antigas de outra sessão, nonce errado, sequência repetida, token forjado, vencido e cross-tenant são rejeitadas. O estado da sessão é comparado em Redis antes do ACK; comando tem ACK único em PostgreSQL e não pode ser aceito novamente.

Cada heartbeat usa Redis, **não executa SQL de atualização no PostgreSQL e não chama Edge Function**, somente neste gateway sintético. PostgreSQL grava online/offline, reconexões e confirmação de comando. A morte forçada de uma instância real por SIGKILL deixa as conexões dos demais processos intactas. Redis mantém lease TTL experimental 12s; o processo sobrevivente faz reap de sessões expiradas, grava offline e recebe reconexões após o crash. Este TTL de QA não comprova SLA de 90s na internet.

A estratégia N+1 mantém capacidade para perder uma instância inteira: alvo de até 175 TVs/shard em serviço, limite máximo 250 conexões/shard, e uma instância adicional para failover. Não foi instalada em nenhuma TV real. A redistribuição foi realizada pelo controlador de QA (não por load balancer de produção).

## Métricas medidas — último run de 4/4 WSS com JWT JTI

| TVs | Instâncias N+1 | Reconexões pós-SIGKILL | RTT P95 / P99 ms | WAL PostgreSQL bytes | Ingresso JSON bytes | Egresso JSON bytes |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 2 | 50 | 20,883 / 34,072 | 50.296 | 143.694 | 100.047 |
| 300 | 3 | 100 | 53,957 / 60,700 | 128.504 | 435.594 | 310.197 |
| 600 | 5 | 120 | 132,605 / 144,079 | 226.144 | 879.274 | 637.137 |
| 1.000 | 7 | 143 | 150,834 / 184,943 | 357.472 | 1.471.236 | 1.073.838 |

RTT é da rede local, não de rede móvel ou WAN. Ingresso/egresso são payloads JSON realmente contados do lado do cliente, não todo o TLS wire nem o consumo da CDN. O cenário de 1.000 TV teve 17.000 amostras RTT, 82.110 operações Redis de todos os tipos medidas na janela e RSS controlador Python 469.048 KiB. Os seis gateways sobreviventes tiveram cada um VmRSS aproximadamente 110–111 MiB, excluídos processo morto, Redis, PG17, kernel e cache. Não somar picos de processos em instantes diferentes para declarar capacidade de host.

## Relatórios originais preservados

O teste original-report-archive-bridge.py importa sem alterações o módulo comercial original. Aos 90 comprovantes históricos sintéticos acrescentou outros 10.000. Cifrou seis segmentos com gzip, AES-256-GCM e SHA-256, guardou manifestos no PG17, removeu eventos brutos SOMENTE da tabela DESCARTÁVEL de QA e restaurou integralmente os 10.090 eventos dos arquivos. Os 40 filtros, 200 agrupamentos, nomes históricos e JSON canônico de referência permanecem exatamente iguais.

SHA-256 final: **161ef8434e8b718b74c77cadd7501e853eff5fb6c62ae7c48b7ded7ad6923d18**. RLS sintético e 12 negações de chave incorreta/AAD de outra empresa passaram. O RPC oficial do Supabase não foi executado e não houve exclusão de dado real.

## Orçamento proporcional, Free → Pro (hipóteses, não faturas)

Documentação pública consultada: [Supabase Billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [Realtime Pricing](https://supabase.com/docs/guides/realtime/pricing), [Realtime Messages Usage](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages). Não usar esta planilha sem revisar quotas/preços antes de contratar.

Hipóteses: 30 dias, TVs ligadas 24h/dia, 1 sinal por 90s, upload horário por TV em Edge separado, prova a cada 15s, arquivos cifrados comprimidos com média de 64,247 bytes/prova de amostra de alta entropia de QA. Nenhum valor é medição de preços, mídia, KMS ou hospedagem.

| TVs | Instâncias previstas N+1 | Heartbeats/mês | Edge uploads/mês | Arquivos cifrados estimados GB/mês | Realtime Pro: excedente hipotético em US$ |
|---:|---:|---:|---:|---:|---:|
| 100 | 2 | 2,88m | 72.000 | 1,110 | US$ 0 |
| 300 | 3 | 8,64m | 216.000 | 3,331 | US$ 10 |
| 600 | 5 | 17,28m | 432.000 | 6,661 | US$ 32,50 |
| 1.000 | 7 | 28,80m | 720.000 | 11,102 | US$ 60 |
| 3.000 | 19 | 86,40m | 2.160.000 | 33,306 | US$ 205 |

A coluna de excedente de mensagens Realtime é **hipotética, NÃO é o custo do gateway dedicado**; aplica-se à alternativa de usar Realtime do Supabase com uma mensagem faturável por heartbeat, acima da franquia Pro de 5 milhões de mensagens e US$2,50 por pacote de milhão. Entrega a assinantes ou broadcasts poderia aumentar a cobrança. WSS dedicado não gera essas mensagens Realtime na plataforma, mas exige hospedagem, Redis, rede e operação próprios, não cotados. 3.000 uploads Edge horários ultrapassariam 2 milhões no Pro mesmo sem outros serviços.

A quota de pico Realtime Pro de referência tem 500 conexões incluídas; 600/1.000 conexões diretas na plataforma exigem aumento de teto/condição do plano. Mudar para pago NÃO cria automaticamente servidores dedicados, HA ou garantia de 1000 conexões. Modelo versão de protocolo vision.presence.v1 é contrato experimental, não foi integrado ao APK.

## Gaps de segurança e implantação

- TOCTOU gate/rota **FAIL confirmado** no teste adversarial; o novo Redis CAS não foi certificado como fencing independente resistente a rollback conjunto. Segurança distribuída é NO-GO.
- Redis single-node e DB no mesmo runner; nenhuma partição de múltiplos hosts, Redis HA/backup durável, AOF, rollback conjunto, split-brain ou revogação entre regiões provados.
- Assinatura HS256 usa segredo fictício compartilhado da bancada; não é identidade de dispositivo Supabase, nem controle definitivo de RLS do writer. A bancada escreve com usuário PG de teste privilegiado, papel de leitura por empresa testado separadamente.
- Certificado TLS autogerado e instalado no cliente de QA, não certificado publicamente válido de produção.
- Nenhum teste de rede/APK real, DNS, discovery, quiosque, offline do player, push ou reinstalação; a troca Free→Pro foi simulação de configuração, não compra ou mudança oficial.
- Redis consome comandos/CPU/RAM, e o total de egress TLS/wire, hosting, KMS, S3/object-store, mídia e serviço de suporte não foi precificado. Não alegar que o plano pago sozinho suporta milhares de telas.
- Antes do GO: resolver TOCTOU; autenticação e revogação reais, proteção contra rollback, WSS com TLS certificado e load balancing, Redis HA, integração APK de homologação, staging equivalente e provas de restore, quotas e failover multi-host.

**Resultado: QA isolado tecnicamente avançou sem tocar produção. Implantação NO-GO; QA_STREAM_GUARD_GROUP=1, drain desligado, manter todas as versões e evidências.**
