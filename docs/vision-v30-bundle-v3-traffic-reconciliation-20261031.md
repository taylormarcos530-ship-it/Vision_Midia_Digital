# Vision V30 — reconciliação do parecer externo de tráfego (31/10/2026)

**Escopo:** `fix/playback-daily-retention-safe-20261030` exclusivamente. Nenhuma alteração em Supabase de produção, Vercel, dispositivos, APKs, dados de clientes ou políticas de retenção. Produção só consultada por leitura de metadados/código-fonte das Edge Functions.

## Resultado da auditoria cruzada

O parecer trazia o HEAD `87de3dac82dc5d49457daf421c147870585e7c2c`, que não correspondeu ao HEAD consultado nesta sessão. A branch começou esta verificação em `d7c521f2fe3fa6e8183e41db2206b2a744d5eb55`. A branch `main` estava em `07d50f2ec1563095c0e17b905c16e1a9143e88b7`.

| Alegação | Verificação concreta |
|---|---|
| `device-gateway` PATCH de pareamento em toda autenticação | **FALSO no HEAD atual da branch.** Já dentro do `if` de renovação de credencial a cada 60s, exatamente como v22 implantada. Não alterado neste trabalho. |
| `device-bundle-stable` PATCH de pareamento por autenticação | **CONFIRMADO**, faltava a condição. Restaurado o mesmo bloco de produção v3: touch a cada 60s e `shouldCleanupPairing` quando o último toque é inválido ou cruza uma janela de 5 minutos. |
| `device-bundle-stable` offline sweep em cada heartbeat | **CONFIRMADO**, faltava limitador de produção v3. Restaurados mapas `lastOfflineSweepByCompany` / `offlineSweepInFlight` e guard de 30s por empresa por instância, preservando atraso de 90s para classificar offline. |

Versões **implantadas** consultadas em leitura:
- `device-gateway` **v22**, sha256 `80818c961a873df1e1953242fb92d2f5e793b2b064590bf88877586d91ce3031`.
- `device-bundle-stable` **v3**, sha256 `b3f8b7eb010b08fb770e4c6109ca9d1ed418154d7f2df5c3cb0784bc7f16a7b8`.

As correções no arquivo `supabase/functions/device-bundle-stable/index.ts` foram transplantadas do código v3 de produção para os blocos de pareamento e varredura. Nenhuma versão hospedada foi implantada. Os demais trechos do bundle diferem da produção em ação **adicional** `command_status` e filtro `.in('status', ['pending', 'sent'])` na confirmação de comandos; essas mudanças da branch foram preservadas para revisão posterior e não devem ser publicadas sem homologar comandos.

## Evidência automatizada

CI da branch isolada: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41206831719

**PASS 34/34 (Node 22 isolado, sem rede Supabase)**:
- **14 testes** de fila local, recuperação, corrupção JSON e falta de espaço;
- **5 testes** de compatibilidade `device-gateway` v22;
- **7 testes** novos de bundle v3, executando diretamente blocos de código extraídos do bundle:
  1. autenticação recente 10s -> sem PATCH; renovação 80s na mesma janela 5m -> 1 PATCH credencial, 0 pareamento; renovação cruzando janela -> 1 PATCH de cada; primeiro uso -> 1 PATCH de cada;
  2. 100 heartbeats em mesma empresa e warm isolate -> 1 varredura, nova varredura após >=30s e outra empresa independente;
  3. duas solicitações concorrentes na mesma empresa -> só 1 varredura em andamento;
  4. falha de varredura -> retry liberado na chamada seguinte;
  5. duas instâncias isoladas independentes -> cada uma pode varrer a mesma empresa; **o limitador não é global**;
  6. gateway v22 mantém bloco de pareamento dentro do touch de 60s;
  7. filtro `pending/sent` de `command_result` da branch foi mantido;
- **8 testes** de idempotência do `playback_batch`.

**Observações importantes:** esses sete testes da proteção v3 usam recortes executados da fonte TS por Node com dependências simuladas (mock SQL), não carga real do Supabase ou TV Box; o `lastOfflineSweepByCompany` é mapa na memória por instância, sem coordenação entre múltiplos workers frios. Não extrapolar redução de tráfego real só com esses testes.

## Publicação: NÃO LIBERADA

Antes de implantar:
1. Comparar `device-bundle-stable` com v3 em runtime Deno/Supabase local; testar `command_status`, `command_result` e suas permissões.
2. Verificar com métricas somente-leitura, sem gerar requisições de teste à produção, volumes PATCH/GET/Edge por janela comparável.
3. Corrigir/revalidar limites de egress e invocações com responsável pelo incidente; nenhuma mudança aqui resolve cotas ultrapassadas automaticamente.
4. Backup real cifrado e restore independente, homologação bancada Casa e autorização específica para qualquer alteração em backend, APK ou TVs.
5. Compactação automática continua desativada em produção e nenhum histórico real foi removido.
