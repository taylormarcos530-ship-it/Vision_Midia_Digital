# LEVANTAMENTO DOCUMENTAL DE PENDÊNCIAS TÉCNICAS — VISION MÍDIA DIGITAL

**Data:** 30/10/2026  
**Escopo:** evidências já registradas no GitHub, sem testes, sem acesso ao Supabase e sem consulta aos dispositivos.  
**Branch de registro:** `audit/playback-query-performance-20261030`.  
**Exclusão explícita:** dossiê do polling experimental de 15 segundos definitivamente arquivado; não reaberto nem incluído como frente de execução.

## 1. Critério de leitura
Este levantamento classifica como **pendência documentalmente aberta** um problema registrado em issue aberta, uma funcionalidade indicada como não homologada em PR, ou uma limitação explícita de `QA_STATUS.md`/`README.md`. **Não é prova de que a falha ainda ocorra em produção em 30/10/2026.** Os documentos gerais podem estar desatualizados diante de PRs e builds posteriores. PR aberto/QA não significa implantação.

## 2. Pendências operacionais com issue aberta

| Prioridade sugerida | Frente | Evidência GitHub | Situação comprovada documentalmente | Próxima porta, sem executar |
|---|---|---|---|---|
| **Alta** | Retenção, crescimento e integridade da prova de veiculação | [Issue #16](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/issues/16) | Diagnóstico histórico de ~178 MB de banco, `playback_logs` ~151 MB e 12 índices; retenção/arquivo/compatibilidade de relatórios ainda sujeitos a QA. Valores são fotografia de 28/10, não métricas atuais. | Desenho de agregados, arquivo restaurável, conciliação de fila offline e relatório do anunciante antes de qualquer limpeza |
| **Alta** | Multiplicação de chamadas Supabase e HTTP 403 de grupos | [Issue #14](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/issues/14), [PR #15](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/pull/15), [PR #12](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/pull/12) | Diagnóstico histórico de permissão SELECT ausente para `device_group_members` e `device_groups` no contexto verificado; propostas de redução de gravações/cache permanecem sujeitas a homologação. Não assumir correção implantada. | Revisão de permissões e custos em QA isolado, métricas por tipo de operação e plano de rollback |
| **Média** | Rotação 270° no boot offline | [Issue #13](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/issues/13), [PR #17](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/pull/17) | Falha reproduzida em V27 QA: mídia cacheada inicia em 0° e volta a 270° após reconexão; correção proposta em V28 QA, sem prova documental de homologação física final. | Verificar em bancada isolada aplicação de configuração persistida antes do primeiro frame, sem regressão de cache |

## 3. Frentes de homologação e integração não declaradas concluídas

| Frente | Referência | Limite documentado |
|---|---|---|
| Push de vencimento do anunciante, avisos Master e datas visíveis | [PR #23](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/pull/23) | Módulos em homologação; envio inicialmente desabilitado; exige VAPID, revisão RLS, teste em dispositivo autorizado e ativação específica |
| Redução de invocações via ciclo consolidado Casa V36 | [PR #22](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/pull/22) | Meta teórica de chamadas Edge, não economia real de DB; piloto Casa, endpoint QA e validação de provas/ACK pendentes |
| Erros repetidos no registro FCM | [PR #21](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/pull/21) | Compatibilidade de registro em QA, não entrega FCM efetiva |
| Retorno do quiosque após abrir outros aplicativos | [PR #20](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/pull/20) | Best-effort condicionado ao firmware; teste físico ainda exigido |
| Comandos push FCM para TV Box | [PR #19](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/pull/19) | Configuração Firebase/servidor, gateway, Play Services e E2E não demonstrados; APK QA não instalar em TVs oficiais |
| Atualização de APK estável 1.5.20→1.5.21 | [PR #18](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/pull/18) | Release candidate isolada; assinatura, reboot, rotação, offline e tráfego precisam de homologação antes de qualquer rollout |
| Status online/offline e atualização do portal do anunciante | [PR #11](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/pull/11), [PR #10](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/pull/10) | Mudanças em QA; compatibilidade de heartbeat, SQL de presença e histórico após reconexão exigem verificação |

## 4. Limitações explicitamente documentadas em arquivos do repositório
- [`QA_STATUS.md`](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/blob/main/QA_STATUS.md) registra que E2E do Master em URL pública, login real, convite/SMTP, suspensão/reativação, upload real e teste em TV Box ainda eram necessários **na data do relatório**. Não presumir que a situação histórica permaneça atual.
- [`README.md`](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/blob/main/README.md) registra cobrança automática, geração de fatura e webhooks como não implementados **na versão descrita**; também contém declarações antigas sobre APK/auto-start que podem estar superadas por branches e PRs mais recentes. Não usar README isoladamente para afirmar estado atual do aplicativo.
- Necessidade de prova de integração em ambiente real e política de não publicação automática aparece repetidamente nos PRs acima.

## 5. Ordem sugerida de tratamento futuro (sem autorização para executar)
1. **Integridade e custo dos logs** (#16): proteger histórico do anunciante e evitar limpeza destrutiva.
2. **Custo de requisições e permissões 403** (#14): distinguir tráfego Edge, REST interno, DB e Storage; não prometer economia sem medição.
3. **Rotação no boot offline** (#13): correção limitada a QA, preservando cache e comportamento já validado.
4. **Homologação dos alertas comerciais** (PR #23) e **integridade do portal** (PRs #10–11).
5. **FCM, quiosque e versões APK** (PRs #18–22), sempre em piloto isolado.
6. **E2E Master e billing** conforme lacunas dos documentos de QA, após atualização documental de seu estado.

A ordem reflete risco de custo, preservação de provas e impacto operacional; **não implica confirmação atual nem ordem de implantação**.

## 6. Governança e limites
- Issues e PRs podem ter novas atualizações; este levantamento usa apenas o conteúdo recuperado nesta consulta.
- A lista não é auditoria exaustiva de todas as branches, migrações, releases ou instalações.
- Nenhum PR deve ser mesclado ou publicado por consequência deste documento.
- Toda intervenção futura exige autorização expressa, backup/rollback quando aplicável, ambiente de homologação e validação antes de produção.
- **Dossiê 15s permanece arquivado e fora de escopo.**

## 7. Registro de não execução
Criado somente este arquivo Markdown na branch de auditoria. **Não** foram executados testes, SQL, acesso ao Supabase, alterações de código, GitHub Actions, deploy, merge, TVs, APK ou produção.

**Resultado: inventário documental de pendências, sem alteração de estado operacional e sem reabertura do dossiê arquivado.**
