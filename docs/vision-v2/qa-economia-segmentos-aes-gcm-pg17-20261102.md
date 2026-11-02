# Vision V2 — economia por segmentos cifrados, recuperação e orçamento Supabase Free

**Data:** 02/11/2026. **Branch:** experiment/vision-v2-sequence-watermark-qa-20261031. **Base preservada:** 7a670d113f5a5a0573a7ddfb0798eb3011bc7a71. **Código QA final antes deste documento:** fe3d324b57bc1e48e7f27a26d25689acdf1a1626.

**Veredito: QA isolado PASS, produção NO-GO. O TOCTOU de gate/rota na bancada multiprocessos anterior segue FAIL e não foi corrigido aqui.** Permanece QA_STREAM_GUARD_GROUP=1, drain desligado. Foram criados apenas arquivos experimentais; sem Supabase oficial, Vercel, APK, player, painel/site, TVs, histórico real ou main.

## Evidências de execuções reais

- [CI principal, run 41532077073](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41532077073): **7/7 jobs PASS**; seis combinações independentes no PostgreSQL 17 descartável (10/100/300 TVs × compressão baixa/alta entropia) e um job de regressão comercial original, sem modificar seu script.
- [CI dos orçamentos, run 41532414366](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41532414366): **2/2 jobs PASS**; Node 20 e Node 22, **26/26 testes em cada um**. Os casos economicamente impossíveis são corretamente recusados pelo guardrail; resultado verde NÃO aprova custos de produção.
- [CI anterior 41531445425](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41531445425): **4/4 PASS**, primeira versão com 10/100/300 TVs e regressão comercial. Evoluído depois para seis perfis de compressão, SQLite FULL real e HTTP loopback real.
- Failures preservados: [41531090976](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41531090976), [41531215738](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41531215738), [41531329390](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41531329390): erros de harness no import InvalidTag, diretório temporário existente e JSON Decimal; corrigidos somente na QA, versões e evidências intactas.

## Arquitetura experimental concretamente executada

1. **Origem:** SQLite local descartável gera um comprovante cada 15s durante **uma hora física por TV**. Nos ensaios são 240 eventos/TV; 2.400, 24.000 e 72.000 eventos com 10/100/300 TVs. O script não substitui nem altera o APK.
2. **Arquivo externo sintético:** cada hora/TV gera um segmento canônico JSON, gzip nível 6, AES-256-GCM com nonce aleatório e AAD contendo empresa/dispositivo/ID. Arquivo cifrado com escrita fsync, rename atômico e fsync de diretório. SHA-256 do JSON original e bytes cifrados; manifesto imutável no PG17. A chave vem de arquivo TEMPORÁRIO de QA, **não é KMS ou proteção produtiva**.
3. **SQL mínimo:** PostgreSQL17 guarda referência e manifesto por segmento e resumo indexado por empresa, dia, TV, campanha e mídia, sem tabela de um registro por exibição. Registros completos continuam criptografados no arquivo; nenhuma prova original é apagada durante ACK.
4. **ACK:** primeiro arquivo íntegro e manifesto SQL+resumo com COMMIT; depois, e somente depois, ACK local SQLite. Reenvio inteiro dos 10/100/300 segmentos é idempotente: sem segunda contagem.
5. **Auditoria/restauração:** leitura integral de todos os segmentos AES-GCM, verificação SHA-256/AAD/tenant, reconstrução de todos os eventos e comparação EXATA dos agrupamentos entre os comprovantes SQLite originais, os objetos recuperados e o SQL diário. RLS habilitado e FORCED nos dois tipos de tabela, leitor da empresa A não vê B e não pode atualizar resumos.
6. **Falhas reais:** 3 SIGKILL em processos OS independentes por job: depois de fsync do arquivo temporário, depois de renomear arquivo e antes do PG, e depois de COMMIT do PG antes de ACK SQLite. Retentativa sem perda nem contagem duplicada.
7. **Restrições:** o SQLite gerou um **SQLITE_FULL real** usando max_page_count num segundo banco QA; não foi esgotamento físico do disco do host. A fila reteve uma prova offline. Um HTTP server loopback 127.0.0.1 retornou códigos reais 402, 429, 503, 401 e 403, com backoffs registrados em SQLite e preservados entre conexões. Não foi teste de HTTP oficial, APK, rede móvel ou Supabase em queda.

## Medições reais de arquivos em uma hora física de exibição a cada 15s

| TVs | Entropia dos event IDs | Provas | Bytes cifrados | Bytes/prova | SQL diário + manifestos | WAL (bytes) |
|---:|---|---:|---:|---:|---:|---:|
| 10 | baixa/repetitiva | 2.400 | 26.652 | 11,105 | 114.688 | 51.632 |
| 10 | alta/SHA | 2.400 | 154.240 | 64,267 | 114.688 | 51.712 |
| 100 | baixa/repetitiva | 24.000 | 266.520 | 11,105 | 475.136 | 551.104 |
| 100 | alta/SHA | 24.000 | 1.542.236 | 64,260 | 475.136 | 551.904 |
| 300 | baixa/repetitiva | 72.000 | 799.560 | 11,105 | 1.204.224 | 1.671.856 |
| 300 | alta/SHA | 72.000 | 4.625.816 | 64,247 | 1.220.608 | 1.674.224 |

Os tamanhos SQL são tamanhos físicos de relações+índices do PostgreSQL para **a amostra**, não tamanho total do banco ou estimativa mensal do PostgreSQL. O banco completo foi ~7,85–8,96 MB, incluindo overhead estrutural do PG recém-criado. RSS de Python no ensaio 300 baixa/alta ~151.748 / 159.676 KiB: inclui processo de QA, não todo o PostgreSQL/host. Não há P95/P99 da gravação fim-a-fim do novo arquivo: a bancada mediu duração total dos jobs, integridade e WAL. Não inventar métricas de latência ou custo por GB.

Os arquivos de alta entropia são **eventos sintéticos com IDs SHA-256 de aparência aleatória**, não distribuição medida em produção. Os números 11–64 bytes/prova não são compromisso comercial de compressão.

## Projeção matemática explícita: 30 dias, NÃO 30 dias executados

A extrapolação é a amostra real de **uma hora** multiplicada pelas horas/dia e por 30 dias, sem overhead de replays/headers, versões, eventos extras, retenção histórica ou mídia.

| TVs | 24h/dia, baixa entropia | 24h/dia, alta entropia |
|---:|---:|---:|
| 10 | 19,19 MB/mês | 111,05 MB/mês |
| 100 | 191,89 MB/mês | 1,110 GB/mês |
| 300 | 575,68 MB/mês | **3,331 GB/mês** |

Os cenários **8, 12, 18, 24h/dia** para 10/100/300 TVs estão individualmente gravados em JSON nos seis artefatos CI. São projeções do modelo, não cargas físicas executadas durante 8–24h. Com arquivos em Supabase Storage Free (1GB), 100 e 300 TVs 24h no perfil alto ultrapassam a quota somente de arquivos; 300 TVs ultrapassam também em 12h e 18h. Egress para restaurar arquivos, downloads de vídeos, CDN, múltiplos meses e custos da hospedagem externa **não medidos**. Não transferir esse custo para outro provedor sem orçamento, quota, backup e testes de privacidade.

### Quantidade de chamadas: outro impeditivo para 300 TVs

| Operação hipotética em 300 TVs 24h | Edge invocations/mês |
|---|---:|
| Upload de um segmento por TV por hora, se cada upload fosse uma Edge | 216.000 |
| Polling de heartbeat/comandos por Edge a cada hora | 216.000 |
| Polling de heartbeat/comandos por Edge a cada 30min | 432.000 |
| Polling de heartbeat/comandos por Edge a cada 15min | 864.000 |
| Polling de heartbeat/comandos por Edge a cada 2min | **6.480.000** |
| Polling de heartbeat/comandos por Edge a cada 90s | **8.640.000** |

A meta de orçamento interna é **350.000 invocações Edge/mês**, reservando 30% ante a quota pública de referência Free 500.000, compartilhada na organização. Um upload por hora isolado 216k deixa somente 134k de margem; se forem ciclos separados de 30 minutos, o combinado seria 648k — além do Free. **Combinar o upload com o heartbeat horário reduz invocations, mas perde a verificação de online/offline próximo de 90s.** Por isso, retenção de arquivos não elimina o desafio de tráfego. Precisamos demonstrar um canal de estado alternativo e economicamente medido, sem fingir que Edge polling 90s é gratuito.

## Regressão comercial original: executada INDEPENDENTEMENTE

O job commercial-parity-qa/qa.py não foi alterado, nem recebeu a nova fixture de arquivos. PASS:
- 40 combinações de filtros comerciais, cinco tipos de agrupamento e **200 comparações** entre eventos originais e resumos;
- históricos de nomes, contagem correta de dispositivos distintos, 24 provas sem horário mantidas fora do relatório comercial;
- JWT sintético expirado/adulterado negado, RLS entre tenants sem vazamento;
- 300 clientes nas três ondas, **45.000 provas**, reinício do gateway, replay após falha e nenhum evento duplicado. P95/P99 HTTP nesse job original foram **1.507,11 / 1.726,79 ms**, não da nova pipeline. O teste novo comparou evento a evento sua própria fonte SQLite, seus objetos AES e seu SQL de resumo, mas **NÃO executou o RPC original diretamente sobre o arquivo novo**. Esta integração fim-a-fim ainda é pendência obrigatória para liberação.

## Restrições e próximos gates

- A chave AES é sintética em disco temporário: falta KMS, rotação, autorização de arquivo por empresa, replica externa, restauração cross-host e custos reais.
- SIGKILL reproduzido 3x/job, mas não prova falha de disco físico, perda de energia no objeto remoto, multi-host com objeto parcialmente replicado nem retomada de vários dias.
- SQLite FULL REAL foi provocado por quota de páginas do motor; **não** se encheu disco físico e não se executou Android/TV Box. Backoff e HTTP real são de loopback, não estão integrados ao APK.
- Nenhum arquivo original de produção foi excluído, substituído ou tocado. Não aplicar política de retenção nem redução de histórico sem paridade completa, backup e restauração.
- A arquitetura de segmentação precisa de definição formal de endereçamento/manifesto, fencing monotônico contra TOCTOU, ACK após COMMIT físico e recuperação de arquivo órfão, com testes de concorrência multiprocessos e adversarial. Segurança multiprocessos anterior **TOCTOU FAIL** prevalece.
- Estimar custos não basta: medir invocations, egress efetivo com mídia, armazenamento consolidado da organização, SQL/WAL e orçamento do provedor. O protocolo antigo de 50 provas por Edge e 2-min heartbeat continua NÃO APROVADO para 300 TVs no Free.

**Decisão:** os testes novos são PASS para as invariantes isoladas. **GO somente para mais QA. Produção NO-GO**, sem promessas de 300 TVs grátis e sem declarar “terminado para nunca mais mexer” antes de homologação real.
