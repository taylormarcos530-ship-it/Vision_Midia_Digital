# Vision V30 — Homologação HTTP isolada do device-gateway (31/10/2026)

**Resultado:** PASS no GitHub Actions, PostgreSQL 17 descartável e servidor HTTP exclusivamente em localhost. **PRODUÇÃO NÃO MODIFICADA.** Branch: `fix/playback-daily-retention-safe-20261030`.

## Origem verificável

- Workflow: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41202769726
- Commit de teste aprovado: `27d749312e233e725b7797410cd5fd541440c43b`.
- Arquivos:
  - `tests/v30-device-gateway-http-integration.cjs`
  - `tests/v30-http-qa-fixture.sql`
  - `.github/workflows/playback-v30-http-isolated.yml`
  - `supabase/functions/device-gateway/index.ts` (correções só na branch)
- Primeiras tentativas HTTP falharam: sintaxe inválida de regex na branch em `register_push`, depois comparação de objetos de realidades VM diferentes; ambos corrigidos na branch, e o workflow final passou.

## Escopo exato do teste HTTP

O teste carregou **o arquivo completo** `device-gateway/index.ts` em VM Node.js, capturou a função registrada por `Deno.serve` e a executou em um servidor HTTP nativo escutando somente 127.0.0.1. A chamada HTTP é real; não se trata apenas do trecho `playback_batch` executado em isolamento. O `createClient` do SDK foi substituído por um **adaptador local de PostgREST sintético**, usando comandos SQL reais contra PostgreSQL 17 descartável. Assim, **não é prova de execução no runtime nativo Deno/Supabase nem de interoperabilidade do SDK real**.

Autenticação testada usando **token da TV de teste**, gerado aleatoriamente, hash SHA-256 e consulta da credencial no PostgreSQL local, pelo código de autenticação real do gateway. Isso valida a regra de autenticação por token da TV; **não valida um JWT de usuário emitido pelo Supabase Auth**. O projeto Supabase de produção tem `verify_jwt=false` para `device-gateway`, logo o gateway usa o cabeçalho `x-device-token`, além da autorização por dispositivo/empresa. RLS dos anunciantes com JWT real continua pendente.

Nenhum token de produção foi obtido ou utilizado. Todos os identificadores, assinaturas, credenciais e dados de reprodução eram sintéticos. O workflow não tinha URL nem chave do Supabase real, não implantou funções, não usou Vercel, não alterou APK ou TVs e não excluiu históricos reais.

## Resultados demonstrados pelos logs — run 41202769726

| Caso | Resultado |
|---|---|
| Token de dispositivo desconhecido | HTTP 401 |
| Credencial revogada | HTTP 401 |
| Empresa suspensa | HTTP 403 |
| Dois eventos novos | HTTP 200, ambos reconhecidos |
| Reenvio idêntico | HTTP 200, zero gravações adicionais |
| Tentativa de sobrescrever company/device no corpo | IDs associados à TV autenticada, nenhuma gravação na empresa alvo |
| Mesmo client_event_id em TVs diferentes | Mantido como identidades distintas |
| Lote misto com evento inválido | HTTP 400, zero gravações do lote |
| Falha sintética do banco antes da escrita | HTTP 400; reenvio gravou exatamente uma vez |
| Conexão perdida após persistir a gravação | Próxima tentativa reconhecida sem novo evento |
| ID previamente resumido e eliminado no DB descartável | Resposta HTTP 200, nenhuma inserção, resumo permaneceu com 1 |
| Fila `flushPlaybackQueue` extraída do Player real | Lote com 1 evento válido e 1 inválido foi **mantido**; recuperado manualmente em QA, reenviado e confirmado |
| Total de requests nesse ensaio | 17 |
| Estado final sintético | 8 reproduções individuais + 1 agrupada no arquivo |

### Compatibilidade com a Edge Function implantada — somente leitura

Na consulta de metadados do Supabase, `device-gateway` estava **ACTIVE, versão 22, verify_jwt=false**. O código implantado v22, lido via conector sem efetuar chamadas de reprodução, ainda usava:
- `String(...client_event_id...).slice(0,120)`, que pode truncar identificadores;
- `continue` sobre itens inválidos no mesmo lote;
- retorno de sucesso `accepted: rows.length` após gravar apenas os itens considerados válidos.

A correção na branch passa a rejeitar **o lote todo** quando existe ID ausente, longo ou data inválida. É uma alteração comportamental deliberada para não fazer o Player descartar comprovantes não gravados, **ainda não implantada**. O gateway v22 continua no Supabase até autorização e publicação específica. Foi também corrigida, só na branch, uma regex de validação do token FCM que não era aceita pelo parser do Node QA; a compatibilidade no runtime Deno ainda precisa de validação nativa.

### Testes PostgreSQL 17 anteriores permanecem como evidência

A suíte do workflow `41201892514` provou 64/65 identificadores por segmento, 20 TVs/2 empresas, 2.000 eventos, 1.000 retries sem novas gravações, rollback, relatórios por TV e isolamento RLS **sintético**, concorrência e backup/restore sintético. Isso não é JWT emitido pelo Supabase Auth.

## Limites restantes / bloqueadores de publicação

1. **Runtime Deno/Supabase nativo + SDK PostgREST real:** o teste acima usa VM Node + adaptador local. Falta instalar a função em um Supabase local descartável com suas configurações reais, sem acessar produção.
2. **Autorização real dos anunciantes:** validar JWT emitido em Auth local e políticas de empresa/RLS, inclusive relatórios e exportações em histórico misto.
3. **Fila permanentemente inválida:** o novo HTTP 400 impede perda silenciosa mas pode manter bloqueado o flush do Player. Projetar quarentena e recuperação com inspeção de eventos, sem apagar comprovantes; não alterar APK de produção sem autorização.
4. **Reconciliar código implantado v22 com o candidato:** verificar diferenças além do bloco de playback para impedir regressões em heartbeat, status, pareamento, atualização e push.
5. **Backup real criptografado, restauração testada, migração/rollback sem perda de resumos** antes de qualquer ativação de compactação.
6. Projeto em restrição de quotas (egress + cached egress + Edge invocations): não usar produção para homologação e não presumir que retenção resolve tráfego, pois são limites distintos.
7. **Publicação:** exige autorização separada. Não habilitar compactação ou retenção, não executar DELETE, não fazer deploy do gateway, não reconstruir APK e não mexer nas TVs.

**Próxima etapa recomendada:** montar e executar Supabase local com runtime Deno e Auth/RLS sintéticos, ou preparar validação no Work com recursos isolados equivalentes; não fazer migração de produção.
