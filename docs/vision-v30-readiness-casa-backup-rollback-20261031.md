# Vision V30 — Roteiro de homologação Casa, backup cifrado, restauração e rollback

Data da revisão: 2026-10-31. **PLANO DOCUMENTAL — NADA DESTE ARQUIVO AUTORIZA A EXECUÇÃO EM PRODUÇÃO.**
Branch isolada: \`fix/playback-daily-retention-safe-20261030\`.
Estado permitido: retenção de sete dias somente na homologação sintética; política em produção NÃO habilitada.
Projeto Supabase de produção teve bloqueio por exceder cotas de Edge Functions, egress e cached egress. Esse incidente deve ser resolvido em fluxo separado **antes de iniciar qualquer rollout**, sem usar as TVs para testes de carga.

## A. Código efetivamente revisado (somente leitura da produção)

Referência: \`device-gateway\` **v22** do Supabase. \`ezbr_sha256=80818c961a873df1e1953242fb92d2f5e793b2b064590bf88877586d91ce3031\`.
Na branch V30 foi feita correção **mínima no bloco \`playback\` / \`playback_batch\`**, mantendo todos os trechos **fora desse bloco idênticos** à v22.
Fingerprints FNV-1a-64 do arquivo normalizado com o bloco playback substituído por \`__PLAYBACK_V30_HERE__\`: \`e1be997fd22fe6c8\`, igual à referência em ambas as versões. Trata-se de um detector de divergência acidental, não de autenticação criptográfica.
A suíte \`tests/v30-gateway-v22-parity.test.cjs\` deve falhar caso qualquer outra rota mude.

Comportamentos preservados:
- Autenticação da TV por token, restrições por empresa/assinatura e intervalo de **60 s** para \`last_used_at\`.
- Limpeza do token de pareamento dentro do mesmo intervalo de credencial; NÃO há novo PATCH a cada requisição.
- \`register_push\` retorna o mesmo fallback \`fcm_unavailable\` apenas para agentes QA 1.5.22/1.5.23, sem criar \`device_push_tokens\` e sem novos envios.
- \`player_settings\`, \`unpair\`, \`heartbeat\`, \`commands\`, \`command_result\`, \`manifest\`, screenshots e outras ações são byte a byte idênticas à v22.
- **Mudança deliberada:** \`playback_batch\` valida todos os registros; um ID inválido/longo ou horário inválido resulta em HTTP 400 SEM gravar uma parte do lote. Uma repetição anteriormente arquivada recebe ACK normal e não incrementa o relatório.

**Limite:** identidade textual e hash de trechos não equivalem a uma homologação real com os dispositivos. Testar a sequência completa em bancada.

## B. Provas em ambiente isolado

- Node 22 — 12 casos de quarentena/space failure e 5 contratos v22 + 8 casos de gateway ACK, **25 testes aprovados**: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41204766408
- PostgreSQL 17 descartável, teste 64/65 e 20 TVs em duas empresas: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41201892514
- HTTP local anterior: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41202769726
- Supabase local real Auth/JWT/RLS e Deno (candidato anterior antes da paridade v22): https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41203827730
- Rerun do Supabase local após o ajuste de paridade v22 deve ter **conclusion=success** separadamente. Não afirmar esse resultado sem conferir o log completo.

### Quarentena sob pouco espaço

\`player.js\` (somente branch QA) mantém os payloads originais em \`vision_player_playback_quarantine_v30\`.
Casos: falha ao arquivar antes de esvaziar a fila; 2.001º evento quando não há espaço; falha ao registrar recuperação; evento com data inválida; offline; recuperação manual sem apagar o original.

**Limitação física:** localStorage tem cota finita e só armazena dados no dispositivo. Se o armazenamento estiver totalmente cheio, preservar registros **já gravados** é possível, mas a TV poderá deixar de registrar eventos NOVOS. Não apresentar isso como segurança de gravação ilimitada, nem instalar sem preparar um diagnóstico/alerta e estratégia de exportação de comprovantes. O app não deve tentar envio repetitivo agressivo ao backend. Considere IndexedDB/armazenamento de arquivo Android em uma mudança futura, submetida a testes e autorização.

## C. Teste de bancada — Casa (necessita autorização específica)

1. Conferir que a versão atual da TV Box Casa funciona; anotar APK/package/versionCode/assinatura, orientação, Wi-Fi, hora incorreta no boot, auto-start, offline, quiosque e identificação da TV. NÃO desinstalar, parear novamente ou atualizar a TV sem autorização.
2. Separar aparelho/instância QA (não conectada ao Supabase de produção) com login e token de teste. Antes de qualquer atualização, copiar configuração local e comprovar que os comprovantes pendentes não serão perdidos.
3. Usar mídias sintéticas, 2 TVs simuladas/usuários de QA, reproduções de teste; registrar número antes/depois, por anunciante/TV/mídia e últimas exibições. A reprodução deve funcionar offline independentemente da hora no boot e enviar apenas uma vez ao reconectar.
4. Simular falha de internet, HTTP 400 em um evento inválido, HTTP 500, token expirado, perda de ACK após commit e armazenamento local quase cheio. Medir chamadas HTTP por ciclo, impacto na CPU e retomada da fila.
5. Validar alteração de playlist, sincronizar, comando remoto, reinício, quiosque, rotação, status ON/OFF, push e limites de consultas. **Nenhuma regressão em recursos existentes.**
6. Capturar resultados PASS/FAIL, logs anonimizados e testes de reinício. Voltar ao APK inicial usando procedimento compatível com a mesma assinatura, sem remover dados locais; abortar se o rollback causar limpeza de armazenamento.

Critério para aprovar: zero perdas/duplicações, relatórios por empresa/TV/mídia idênticos, pareamento mantido, nenhuma chamada adicional por requisição no push/pairing, offline e quiosque preservados.

## D. Backup real criptografado — aprovação e verificação antes de qualquer exclusão

**NÃO EXECUTADO NESTA ETAPA.** Procedimento futuro requer autorização separada, janela de operação e acesso técnico apropriado com privilégio de **leitura** para extração.

1. Registrar hora UTC e estado do Supabase, volume físico e logical counts por empresa/TV/campanha/mídia, dados da política e versão de cada Edge Function/commit. Obter export **consistente** do PostgreSQL com cliente compatível (PostgreSQL 17), incluindo schema, dados, funções, índices, políticas, grants e objetos relevantes à recuperação.
2. Encaminhar o dump imediatamente a criptografia **age** usando apenas a chave pública de recuperação do proprietário, com segredo privado fora do GitHub, Vercel, chat e logs. Nenhuma senha ou chave privada deve aparecer em scripts/versionamento.
3. Registrar SHA-256 do arquivo **criptografado**, tamanho e hora; guardar a cópia em pasta privada e em local independente. Não confundir arquivos de mídias do Supabase Storage com dados PostgreSQL: backup do banco não substitui cópia de objetos nem da configuração de Storage/Edge.
4. Descriptografar em ambiente offline isolado, restaurar com \`pg_restore\` em PostgreSQL 17 descartável; conferir execução, RLS, objetos, permissões, contagens e relatórios, além de hashes de arquivos de mídia da cópia separada.
5. Validar restauração e plano de recuperação de alterações posteriores ao backup **antes** de autorizar qualquer manutenção em produção. Teste de restauração com dados sintéticos já passou, mas não comprova backup do sistema real.

Critérios: backup existente, íntegro, criptografado, restaurável; volume/contagens por locatário em paridade, chaves privadas não expostas, serviço recuperável.

## E. Publicação em estágios — NÃO EXECUTAR AGORA

Fase E0 (atual): \`enabled=false\`, sem cron, sem limpeza; branch isolada, testes somente locais. Sob cotas Supabase excedidas, bloqueio de rollout é obrigatório.

Fase E1 (somente após autorização e cotas restabelecidas): snapshot/backup real confirmado; publicar relatório alternativo V30 sem trocar o endpoint antigo; conferir consultas históricas, RLS, portal anunciante e exportação de eventos, durante a mesma janela.

Fase E2 (somente autorização separada): publicar **a mudança mínima do gateway** após comparar v22 com o pacote realmente destinado ao deploy. Manter monitoramento de Edge invocations, cached egress, egress e escrita SQL. Não publicar Player/APK junto com backend sem motivo homologado.

Fase E3 (autorização explícita e backup verificado): ativar compactação com \`raw_days=7\` e demais gates em lotes pequenos supervisionados, **sem executar limpeza em massa nem cron automático inicialmente**. Conferir auditoria por empresa/TV/media/campanha, replays offline antigos, contagem comercial, last-play, horários com fuso e estabilidade; abortar no primeiro desvio. O ledger de 128 bits tem risco criptográfico negligenciável de colisão, mas **não é uma garantia matemática de identidade perfeita**.

**Bloqueio absoluto:** não executar \`DELETE\`, \`VACUUM FULL\`, \`REINDEX\`, \`pg_repack\`, deploy ou novo APK durante a presente homologação.

## F. Rollback e pontos de não retorno

- **Antes da compactação real:** gateway pode voltar à versão 22 após preservar código-fonte e conferências, contanto que não haja dependência de novas funções; painel pode manter o relatório antigo; credenciais e banco permanecem intactos.
- **Depois da primeira compactação real:** rollback NÃO é apenas voltar código. A v22 antiga e \`get_playback_report\` podem deixar de ver o histórico arquivado. **Nunca remover ledger, arquivo diário ou relatório híbrido** enquanto houver qualquer dado bruto compactado. Desativar novas operações, manter acesso ao relatório híbrido, fazer análise de impacto e só então restaurar/conciliar em ambiente isolado.
- **Falha de deduplicação/replay:** congelar compactação e identificar dados afetados antes de qualquer reprocessamento. Não reimportar eventos antigos automaticamente sem um ledger consistente.
- **Falha de storage ou cotas:** preservar modo offline existente, sem flood de requisições; alertar e evitar alterações no aplicativo até o serviço ser recuperado.

## Critério de saída

Liberar produção apenas com: [ ] Auth e relatórios com dados representativos; [ ] auditoria do gateway v22 sem desvios não aprovados; [ ] fila/armazenamento QA na TV Box; [ ] backup cifrado real restaurado; [ ] plano de rollback com eventos tardios; [ ] recursos de quota/egress restabelecidos; [ ] autorização específica do usuário para a fase pretendida.
