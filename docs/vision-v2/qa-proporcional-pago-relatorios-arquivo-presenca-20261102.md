# Vision V2 — Arquitetura proporcional Free/Pro, relatório cifrado e presença persistente

Data: 02/11/2026. Branch: experiment/vision-v2-sequence-watermark-qa-20261031. Base imutável: ce2375d4c739a31b65348653f24c883ebb783263. Código experimental validado: ad687026c33c5037b193bfde85f5848fcae28b28.

**Produção NO-GO.** Segurança TOCTOU dos gates e fencing ainda FAIL. QA_STREAM_GUARD_GROUP=1; drain desligado. Nada foi implantado, consultado ou modificado no Supabase oficial, APKs, site, painel, TVs, dados/históricos reais ou main.

## Evidência reproduzível

[GitHub Actions 41537195814 — 7/7 jobs PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41537195814): um job para relatório comercial recuperado em PostgreSQL17, quatro jobs para conexões TCP persistentes de 10, 100, 300 e 600 clientes, dois jobs Node 20/22. Todos utilizam dados locais ou sintéticos em GitHub Actions descartável.

A política de crescimento Node 20 e Node 22 obteve **20/20 PASS em cada versão**. Seus testes cobrem planos Free, Pro e Pro sem spend cap; 10/100/300/600/1000 clientes; distribuição de 3000 dispositivos por shards com máximo 250 conexões cada; autenticação simulada; recusa de excesso; leases de conexão e liberação obsoleta; limite de custo e protocolo de cliente estável. A política experimental NÃO foi integrada ao produto.

## Reconstrução comercial ORIGINAL de arquivo cifrado

O novo script importa sem alterações o módulo original commercial-parity-qa/qa.py. Ele executa a paridade original, acrescenta 10 mil eventos sintéticos aos 90 existentes e produz a referência JSON de 40 combinações de filtros e cinco agrupamentos, total **200 comparações**. Gera seis arquivos gzip e AES-256-GCM com autenticação de empresa/dia, SHA-256 para bytes originais e cifrados e manifestos imutáveis no PostgreSQL17.

Depois apaga os registros brutos **SOMENTE do banco descartável de QA**, recupera os 10.090 eventos exclusivamente dos arquivos cifrados e executa as consultas comerciais de referência sobre a tabela restaurada. Todas as colunas e o JSON dos filtros/agrupamentos são iguais ao original.

SHA-256 do JSON dos relatórios: **161ef8434e8b718b74c77cadd7501e853eff5fb6c62ae7c48b7ded7ad6923d18**. 12 tentativas com chave ou AAD de empresa errada rejeitadas. RLS de índice por empresa, duplicação de manifesto impedida. Arquivos cifrados **449.696 bytes**, tabela de resumo+manifesto **581.632 bytes** na fixture, RSS Python **118.584 KiB**; cerca de 3s CI. Esse resultado é para dados sintéticos, não é previsão de custo por TV. **O RPC oficial de produção NÃO foi executado**.

## Canal persistente REAL de bancada, sem Edge por heartbeat

O ensaio abriu conexões TCP reais em loopback, 40 rodadas por dispositivo simulando 90 segundos por rodada (uma hora de relógio virtual). Repetiu a autenticação sintética, descartou heartbeats antigos, realizou cinco desconexões e cinco reconexões e reconheceu um comando antes e outro depois da reconexão. Cada teste gravou no PostgreSQL17 somente mudanças de estado, nunca um UPDATE por heartbeat.

| TVs | Mensagens TCP efetivamente recebidas | Gravações SQL de transições | SQL por heartbeat | P95 ms | P99 ms |
|---:|---:|---:|---:|---:|---:|
| 10 | 600 | 30 | 0 | 0,616 | 0,828 |
| 100 | 4.200 | 210 | 0 | 6,593 | 7,057 |
| 300 | 12.200 | 610 | 0 | 28,033 | 31,384 |
| 600 | 24.200 | 1.210 | 0 | 62,523 | 64,872 |

P95/P99 são RTT na máquina do teste, não latência de internet real. Os 0 Edge se aplicam SOMENTE à bancada TCP, que não invoca Supabase. O teste não é WebSocket, não testa TLS, JWT de produção, multi-host, distribuição externa, failover Redis ou APK.

Em 300 TVs com um heartbeat a cada 90s por 24h, **8,64 milhões de sinais/mês** ainda atravessam a rede do gateway. Se enviado via Supabase Realtime, a mensageria é faturada separadamente: pode contar envio e entregas a assinantes. Trocar Edge polling por Realtime não elimina custo; trocar por gateway dedicado cria custo de servidor, cache e suporte. A diferença é não consumir 8,64 milhões de Edge invocations apenas para status.

## Plano pago e escalonamento proporcional

Limites Supabase públicos de referência em novembro de 2026:

- [Realtime Limits](https://supabase.com/docs/guides/realtime/limits): Free até 200 conexões; Pro com spend cap até 500; Pro sem spend cap até 10.000, sujeitos à configuração do projeto e limites de taxa.
- [Billing](https://supabase.com/docs/guides/platform/billing-on-supabase): Free 500 mil Edge invocations/mês, banco 500MB, Storage 1GB e egress 5GB. Pro inclui 2 milhões Edge, 8GB disco DB, 100GB Storage e 250GB egress, com cobranças e condições adicionais.
- [Realtime billing](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages): Free 2 milhões mensagens, Pro 5 milhões incluídas, com excedentes pagos.

O QA cria política separada do player: protocolo de cliente vision.presence.v1; tier e provider são configurações do backend. Para gateway dedicado a capacidade é planejada com alvo de 175 TVs por shard e limite duro de 250 conexões por shard, com SHA-256 para ordenação determinística e recusa de novas conexões quando cheio.

| TVs | Shards QA alvo 175 / máximo 250 |
|---:|---:|
| 10 | 1 |
| 100 | 1 |
| 300 | 2 |
| 600 | 4 |
| 1.000 | 6 |
| 3.000 | 18 |

Antes da correção, um hash mais simples concentrou até 298 TVs num único shard mesmo com média de 200. O novo algoritmo e hard admission foram testados. Estes limites são parâmetros de uma futura implantação, NÃO instâncias contratadas ou ativas.

**Para mudar Free → Pro sem alterar novamente o cliente**, a integração futura deve permitir descoberta/assinatura de configuração remota, manter a versão do protocolo estável e mudar endpoint, quotas e rota no servidor. Isso é um objetivo de compatibilidade: o APK instalado atualmente não foi alterado nem homologado com esse novo protocolo. Não afirmar que a troca já funcionará sem atualização de APK.

## Falhas e requisitos ainda bloqueantes

1. Implementar WSS real com TLS, autenticação por dispositivo e empresa, JWT/claims verificados, expiração e revogação sem TOCTOU, canais de comandos assinados e isolamento RLS. O HMAC do QA é fictício.
2. Testar 300/600/1000 conexões entre vários servidores e zonas, com backplane/Redis TTL, reinício, SIGKILL, switch de rota, relógios atrasados e reconexões simultâneas.
3. Integrar o cliente real em um APK de homologação, sem instalar em TVs reais ainda; provar auto-start, cache offline, rotação e playlist existentes.
4. Executar o RPC comercial real sobre arquivos restaurados em Supabase **de homologação descartável**, com RLS, exportação, versões de manifesto, KMS e rotação real, backups remotos. Até aqui o PostgreSQL17 replica apenas a forma das consultas originais.
5. Testar retenção, egress dos vídeos, discos, WAL, CPU/memória de todos os serviços, orçamento de hosting externo e preço por tier, alarmes de 402/429/503, SLA de status ONLINE/OFFLINE e política segura de degradação.
6. Corrigir o TOCTOU de gate/rota e demonstrar PASS em cenário adversarial multiprocessos; não usar a trava de capacidade para afirmar fencing seguro.
7. Nenhuma alteração ou exclusão de históricos reais antes de backup, migração canário, comparação bit a bit e rollback.

**Decisão:** os sete jobs CI validam a arquitetura experimental em recortes relevantes. O plano pago pode sustentar crescimento quando limites e infraestrutura forem ajustados, mas não garante automaticamente capacidade sem engenharia, testes e monitoramento. **Produção permanece NO-GO.**
