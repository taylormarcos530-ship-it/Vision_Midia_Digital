# Vision Mídia Digital — Homologação adversarial e plano de staging / rollback (somente especificação)

**Checkpoint anterior:** `d0151e705df10a7cb70d6e4a34e77b14e34d00f6`.
**Branch isolada:** `fix/advertiser-portal-safety-20261013`.
**Status deste bloco:** testes de fixture e documentação; **NÃO** foi executada nenhuma migração, conexão remota, deploy, release de APK ou alteração de playlist/TV.

## 1. O que foi validado

Novo `tests/commercial-receipt-adversarial-lab.test.cjs` com 14 cenários, exclusivamente sobre `commercial-staging-receipt-lab.mjs` (inalterado). O runner aprovou **286/286 testes, zero falhas** e o guardião dos arquivos operacionais: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38648576317

### Resultados específicos

1. Cem reenvios de um único registro em ordens variadas: só um registro aceito/consolidado por ocorrência.
2. Duas formas de duplicação: mesmo `client_event_id` e novos IDs tentando concluir a mesma ocorrência; nenhuma inflação na consolidação sequencial.
3. Dezoito anúncios de fixture com mensagens inválidas/duplicadas embaralhadas por cinco sementes determinísticas: exatamente dezoito conclusões aceitas.
4. Registros `completed:false` contam como tentativa, sem atualização posterior oportunista para `completed:true`.
5. Trinta e duas mensagens simultâneas submetidas a **uma fila serial em memória**: aceitação única. **Essa fila é apenas um modelo de atomicidade, não um mecanismo implementado no PostgreSQL.**
6. A publicação de pausa/remoção antes do recebimento recusa recibo antigo; se o recibo foi aceito primeiro, sua repetição após a pausa continua idempotente. A sequência de operações é parte do contrato que terá de ser assegurado por transações.
7. Primeira entrega após 12 horas desconectado excede o TTL fictício e é recusada, sem modificar a programação base; uma repetição já aceita antes da queda continua deduplicada no dia seguinte.
8. Atribuição do dia do relatório segue a **chegada ao servidor no fuso America/Sao_Paulo**, somente nesta bancada. Não afirmar equivalência com o SQL existente, que considera a data de início registrada na reprodução.
9. Mensagens com revisão, horário ou TV incompatíveis são recusadas individualmente, preservando os registros válidos do lote.
10. **Limitação comprovada:** duas chamadas processadas independentemente a partir do mesmo snapshot podem aceitar conclusões conflitantes. Não há garantia real de atomicidade sem índice UNIQUE/transação de banco.

Na primeira execução os 14 cenários funcionaram, mas uma checagem textual local leu a expressão regular do próprio teste e falhou por autocorrespondência; ela foi restringida ao módulo testado e a suíte voltou a **PASS**. Nenhum ajuste ao player ou modelo de recibos foi necessário.

## 2. Especificação de integração futura — não executar agora

### Pré-requisitos técnicos

- **Ambiente independente:** projeto Supabase de homologação separado, com fixtures sintéticas, domínio não produtivo e Storage isolado, sem cópia de tokens, usuários, dados ou mídias de clientes reais.
- **Servidor autoritativo:** identidade da TV derivada de autenticação válida, validação de vínculo com empresa, playlist efetivamente atribuída, versão da programação, campanha ativa/datas/segmentação, versão imutável do anúncio e capacidade do player.
- **Idempotência de dois níveis:** índice único por `(device_id,client_event_id)` e outro por `(device_id,occurrence_id)` na futura estrutura de recibos **de homologação**, protegidos na mesma transação que finaliza a ocorrência. O estado do anúncio deve ser conferido sob controle de concorrência, evitando a leitura de versões antigas.
- **Registro imutável:** eventos brutos preservados; conciliação calculada do conjunto aceito, com status de rejeição/duplicidade registrados para auditoria. Não sobrescrever `playback_logs` existente nem reutilizar o `campaign_id` operacional como se fosse um anúncio comercial.
- **Relatório responsável:** diferenciar `tentativa`, `conclusão declarada pelo player` e `exibição auditada`. Mesmo um recibo íntegro não prova que a tela mostrou o anúncio: não usar estes contadores fictícios para faturar.
- **Offline:** desenhar uma janela e política específica de reenvio tardio; após expiração, não perder a playlist do estabelecimento. Decidir antes da homologação se o dia contabilizado será o de início, término validado ou chegada, com tratamento de relógio incorreto/fuso e reenvio após virada de dia.
- **Compatibilidade:** players legados seguem usando a programação atual. Novos recursos devem ser opt-in/versionados; sem playlist explícita a TV mostra **Aguardando playlist**.

### Portões de aceitação — todos obrigatórios antes de solicitar autorização para qualquer ativação

1. Testes reais de duas requisições simultâneas na mesma ocorrência contra **um banco de staging isolado**, incluindo colisões de IDs e transações interrompidas; resultado exatamente um registro final e nenhum item base perdido.
2. Alterar, pausar, remover e expirar um anúncio durante reprodução; cancelar inserções pendentes, manter todo o conteúdo do ponto e não criar uma nova conclusão falsa.
3. Execução em Android TV de teste, com APK específico de laboratório, sem permissões nem dados de TVs de clientes. Validar codecs, orientação, preenchimento, duração real, cache e retorno à playlist sem falhas.
4. Reconciliar lotes de até 100 eventos com reenvio repetido/fora de ordem; testar 1 min, 12 h e 48 h sem conexão. Divergências de dias, tentativas e conclusões devem ser explicadas e auditáveis.
5. Validar conta anunciante x conta empresa x Master com RLS de staging, Storage segregado e autorização, inclusive acesso negado após desativar/expirar.
6. Verificar que a flag comercial está **desativada por padrão**, versão legada se comporta exatamente como antes e não existe deploy automático para sites produtivos.
7. Produzir backup/checkpoint verificável de código e configuração atuais e registrar plano de reversão. A aprovação futura deve ser separada para cada etapa e cada ambiente.

## 3. Plano de rollback proposto — não executado

### Caso um ensaio de staging falhe

- **Ação imediata:** impedir novas emissões/inserções comerciais via flag de staging, sem modificar as playlists. Rejeitar novas ocorrências; concluir apenas trabalho já aceito de acordo com as regras de auditoria; não registrar impressões por estimativa.
- **Programação do estabelecimento:** continuar ou restaurar unicamente o manifesto base previamente atribuído. Não reutilizar fallback comercial, não ligar campanhas automaticamente nem alterar mídia do ponto.
- **Estado das TVs:** desativar o recurso no ambiente de testes; preservar token/pareamento e player legado; interromper somente o componente comercial experimental. Registrar TV/revisão/rodada afetada e ocorrência rejeitada, sem divulgar dados sensíveis.
- **Dados:** preservar os registros brutos/aceitos para auditoria e reprocessar resumos idempotentemente; não apagar registros operacionais, não fazer `DELETE` em `playback_logs`, não sobrescrever tabelas de empresas, playlists ou campanhas existentes.
- **Código:** voltar exclusivamente o branch/artefato de laboratório ao checkpoint anterior validado, com hashes e evidências. Não publicar automaticamente um commit antigo na produção; toda reversão operacional exige autorização.
- **Banco:** evitar rollback destrutivo de esquema que descarte dados. Se uma futura migration falhar, preferir desativar o recurso e elaborar uma migration corretiva revisada **em staging**; mudança no banco produtivo permanece proibida nesta fase.

### Critérios de saída do rollback

- A TV de laboratório, sem anúncio habilitado, apresenta só a programação base esperada e conserva sua ordem.
- Nenhum recebimento comercial novo cria conclusão faturável; reenvios idênticos permanecem idempotentes.
- Nenhum erro de integração interrompe mídias do estabelecimento ou altera `Aguardando playlist`.
- Divergências de contadores ficam registradas como pendências e não são silenciosamente corrigidas com estimativas.
- A verificação do código operacional protegido e todos os testes do laboratório voltam a PASS.

## 4. Limites desta entrega e próxima etapa

Este bloco **não** implementa servidor concorrente real, transações PostgreSQL, reconhecimento de pixels na TV, recibos assinados, reconciliação offline prolongada ou faturamento de anúncios. `referenceTransactionQueue` é fixture serial em Node.js; o ensaio sem fila demonstra que a ausência de atomicidade é risco real de projeto, não problema resolvido no banco existente.

**Próximo passo seguro:** detalhar em SQL de **documentação não executável** as restrições/ordem transacional da futura estrutura de staging, ou construir uma bancada isolada de concorrência PostgreSQL com dados sintéticos apenas após autorização. Não executar migrações nem deploy sem solicitação explícita.

**Proteções permanentes:** `player.js`, `android-player/`, playlists, `supabase/functions/device-gateway/index.ts`, Supabase/Edge Functions de produção, Netlify/Vercel e TVs dos clientes intocados.
