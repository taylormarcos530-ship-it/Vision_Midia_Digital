# Vision Mídia Digital — Contrato de atomicidade PostgreSQL (SOMENTE ESPECIFICAÇÃO)

> **NÃO EXECUTAR. NÃO É MIGRATION.** Os blocos SQL abaixo são modelos de revisão arquitetural, com nomes de esquema fictícios e dependências inexistentes. Esta documentação não autoriza criar tabelas, publicar Edge Functions, conectar staging ou modificar produção.

- Base da branch isolada: `d91a039ca6bb584ae11ca4809ab5d0090f9b3f67`.
- Branch: `fix/advertiser-portal-safety-20261013`.
- Objetivo: planejar confirmação de exibição comercial idempotente por TV e por ocorrência, convivendo com a playlist normal **sem escrever em `playback_logs` existente**.
- Fonte inspecionada em modo somente leitura: `device-gateway/index.ts` aceita `playback_batch` até 100 registros e já usa `onConflict: 'device_id,client_event_id', ignoreDuplicates: true`. Esse contrato existente não será substituído; também não constitui prova física de anúncio exibido.
- A consolidação experimental `vision_commercial_refresh_daily` do SQL existente usa início da reprodução no horário de São Paulo. O laboratório de recibos conta por **dia de chegada ao servidor**. **A definição de dia oficial segue em aberto; nenhuma conciliação financeira pode assumir igualdade entre ambas.**

## Invariantes mandatórios

1. **Playlist principal soberana:** comerciais são aditivos e opcionais; nenhuma TV sem playlist recebe anúncios, e remover comerciais não remove itens da mídia do ponto. Não reaproveitar a tabela operacional de campanhas para anúncios da Vision.
2. **Feature desativada por padrão:** não alterar o player/APK atual, `device-gateway`, nem o flag de produção. Compatibilidade estrita para players legados.
3. **Contexto autenticado:** `device_id` e `company_id` derivam do token verificado pelo servidor; campos enviados pelo player nunca podem escolher livremente outra TV/empresa.
4. **Dois invariantes únicos (futuros):** `UNIQUE (device_id, client_event_id)` evita repetição de evento; `UNIQUE (device_id, occurrence_id)` impede fechar uma ocorrência duas vezes com IDs de evento distintos.
5. **Validação completa:** ocorrência emitida e ainda válida, mesma TV, campanha/revisão/mídia previstas, destino ativo, agenda, época de programação, relógio de servidor, conclusão com término RFC3339 consistente. Um `client_event_id` repetido com payload diferente é **conflito**, não sucesso.
6. **Contagem conservadora:** apenas confirmação final aceita entra no ledger; `completed=false` é tentativa. Um recibo declarado `completed=true` continua sendo **alegação do player**, não medição auditada da tela.
7. **Registro histórico imutável:** desativação ou edição de campanha cancela somente novas ocorrências; não apaga conclusões já aceitas. Relatórios são recalculados do ledger idempotente.
8. **Nenhuma falha de anúncio deve impedir a reprodução base.** Se o recibo ou resumo falhar, a reprodução do estabelecimento segue intacta. O painel anunciante só mostra dados verificáveis e rotulados apropriadamente.

## Esquema proposto — EXEMPLOS CONCEITUAIS SQL, NÃO APLICAR

```sql
-- ILUSTRAÇÃO APENAS: lab_commercial NÃO EXISTE e NÃO DEVE SER CRIADO AGORA.
-- event authorization must be derived from a server-verified device token.
CREATE TABLE lab_commercial.device_epochs (
  device_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  program_epoch bigint NOT NULL CHECK (program_epoch > 0),
  program_fingerprint text NOT NULL,
  commercial_enabled boolean NOT NULL DEFAULT false
);

CREATE TABLE lab_commercial.playback_occurrences (
  device_id uuid NOT NULL,
  occurrence_id uuid NOT NULL,
  company_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  media_id uuid NOT NULL,
  program_epoch bigint NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('issued','cancelled','finalized')),
  PRIMARY KEY (device_id, occurrence_id),
  UNIQUE (device_id, occurrence_id, revision_id),
  CHECK (expires_at > issued_at)
);

CREATE TABLE lab_commercial.playback_receipts (
  device_id uuid NOT NULL,
  occurrence_id uuid NOT NULL,
  client_event_id text NOT NULL CHECK (char_length(client_event_id) BETWEEN 1 AND 120),
  revision_id uuid NOT NULL,
  completed boolean NOT NULL,
  claimed_ended_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  normalized_payload_fingerprint text NOT NULL,
  PRIMARY KEY (device_id, client_event_id),
  UNIQUE (device_id, occurrence_id),
  FOREIGN KEY (device_id, occurrence_id, revision_id)
    REFERENCES lab_commercial.playback_occurrences (device_id, occurrence_id, revision_id),
  CHECK (NOT completed OR claimed_ended_at IS NOT NULL)
);
```

**Observações de desenho:** as tabelas são propositalmente novas e fictícias; não adicionar colunas nem triggers no `public.playback_logs` dos clientes. As FKs de campanha, revision e dispositivo devem ser modeladas apenas ao montar a futura base isolada com seus respectivos fixtures; este exemplo **não** está pronto para deploy. Um `normalized_payload_fingerprint` precisa ser calculado pelo servidor sobre formato canônico e só é útil se comparado a conteúdo confiável; não pode ser aceito do player. Especificar semântica de atualização imutável e permissões RLS antes de gerar migrations.

## Recebimento atômico — contrato de transação, não função executável

1. Autenticar o token real da TV **antes** de abrir a transação. Obter `device_id`/empresa verificados; recusar credenciais não vinculadas e evitar expor identificadores sensíveis.
2. **BEGIN** no banco de **staging isolado futuramente autorizado**, usando um único escopo transacional por evento. Bloquear a mesma linha `lab_commercial.device_epochs` `SELECT ... FOR UPDATE` para **todo** recebimento e **toda** publicação/revogação de programa da mesma TV; fixar a ordem global dos locks para evitar deadlocks. Capturar o tempo do servidor após adquirir esse lock.
3. Consultar primeiro, sob a mesma transação, se `(device_id,client_event_id)` já foi aceito. Se o payload canônico for idêntico, devolver **duplicate_event** sem contar novamente, mesmo após expiração. Se divergir, retornar **client_event_id_collision**. Nunca atualizar `completed` na linha original.
4. Confirmar ocorrência `(device_id, occurrence_id, revision_id)` emitida pelo servidor, vinculada à época/programação, campanha/destino e janela temporal elegíveis. Usar lock sobre a ocorrência (ou lock de dispositivo com ordem consistente). Recusar emissão antiga após campanha desativada, offline expirado, mídia substituída ou player incompatível.
5. Registrar o recibo terminal com `INSERT ... ON CONFLICT DO NOTHING RETURNING` (não usar upsert que faça UPDATE do status existente); depois de conflito, ler ambas as chaves únicas dentro da transação e distinguir **reenvio idêntico**, **mesma ocorrência com novo evento**, **ID de evento com payload divergente**. Não confirmar um novo recibo se já existir conclusão ou tentativa final para essa ocorrência.
6. **COMMIT** da ocorrência final + registro aceito na mesma transação. O envio do ACK pode se perder; um reenvio idêntico deve encontrar a linha existente e ser idempotente. Em timeout/incerteza, cliente não deve inventar novo `client_event_id`.
7. Processar lotes de 1 a 100 eventos como itens independentes, com decisão clara de êxito/erro por item; um registro inválido não pode apagar um evento válido do mesmo lote. O comportamento exato de rollback parcial precisa ser testado na futura base isolada.
8. Atualizar o resumo **fora do caminho crítico** a partir dos recibos aceitos (recomputar `attempt_count` e `completed_count` para a chave de relatório, em vez de somar eventos de rede). Falha no resumo deixa pendência observável e **não bloqueia** a mídia base nem cria conclusão faturável presumida.

### Publicação ou revogação concorrente

A publicação de revisão comercial na mesma TV **deve adquirir o mesmo lock em `device_epochs`**. Dentro da transação, atualizar `program_epoch` e fingerprint, desabilitar ou invalidar ocorrências pendentes, registrar motivo e COMMIT. Se publicação confirmar primeiro, um recibo antigo não é aceito; se o recibo foi confirmado primeiro, o registro histórico permanece aceito uma vez. Proibir remoção destrutiva de recibos para desfazer uma desativação. Se múltiplas TVs estiverem envolvidas, aplicar locks ordenados por UUID e isolar transações; falha de uma TV não deve impactar as demais.

### Limites de prova e regressões

O teste anterior demonstrou que dois recebimentos simultâneos a partir de snapshots de memória distintos podem aceitar a mesma ocorrência. Os índices + lock são requisitos de arquitetura, **não foram aplicados nem provados contra PostgreSQL real**. Eventos falsificados com nonce válido podem continuar alegando conclusão; a auditoria comercial exigirá outra fonte de evidência. A política de reenvio após 12/48 horas e a escolha de dia de cobrança ainda estão pendentes; não permitir que diferenças entre início, fim e chegada alterem contagens silenciosamente.

## Matriz de homologação futura (não executar nesta etapa)

| Caso em banco de staging futuro | Esperado |
|---|---|
| 32 recibos idênticos simultâneos | 1 aceito, demais duplicados idempotentes |
| 32 IDs distintos para uma única ocorrência | Exatamente 1 terminal; demais conflitos de ocorrência |
| Mesmo client_event_id com payload diferente | Colisão rejeitada sem UPDATE |
| Desativação primeiro / recibo depois | Ocorrência antiga recusada; playlist base inalterada |
| Recibo primeiro / desativação depois | 1 histórico aceito; repetição continua idempotente |
| Interrupção após COMMIT, antes do ACK | Reenvio recupera confirmação existente, sem contar duas vezes |
| Falha e retry da consolidação diária | Mesmo resultado recalculado, nenhuma dupla contagem |
| TV trocada/legada/sem playlist | Sem anúncios; base continua ou exibe Aguardando playlist |
| Offline 12 h ou 48 h | Política ainda em definição; nunca contar eventos tardios automaticamente |
| Virada de dia no fuso de São Paulo | Política de atribuição explícita, reconciliada com SQL existente |

## Rollback seguro — somente plano

**Portão zero:** guardar commit aprovado, fixture, hashes de artefatos de testes e flags do ambiente isolado (sem dados de clientes). Não utilizar backup de produção como sandbox. Abrir staging real só após autorização específica.

Se falhar: desabilitar **apenas** a funcionalidade comercial isolada, impedir novas ocorrências, não alterar playlists, conservar eventos brutos para auditoria e manter o player legado. Voltar à programação base. Nunca executar `DELETE`, `TRUNCATE`, `DROP` ou rollback destrutivo contra dados do ponto. Um esquema experimental defeituoso deve ser desativado e corrigido por revisão de migration apenas em ambiente aprovado. Toda eventual alteração operacional ou publicação em produção exigirá autorização separada.

## Checklist de autorização (pendente)

- Projeto staging verdadeiramente segregado, contas/TVs/mídias fictícias e permissões verificadas.
- Revisão de FKs, RLS, autenticação, idempotência, transação e política de relógio.
- Cenários reais de concorrência e rollback em PostgreSQL isolado.
- Teste Android TV de laboratório com player/versão distintos, sem afetar instalações existentes.
- Prévia, relatório, logs e contadores diferenciando tentativas de conclusões declaradas.
- Backup verificável e **aprovação explícita** antes de qualquer deploy, atualização do APK ou ativação de campanha real.

**Status desta entrega:** especificação versionada somente no GitHub, sem conexões remotas, sem DDL aplicada, sem migrations, sem alteração em Supabase/Edge Functions, sem deploy e sem mudanças no APK/player/playlists.
