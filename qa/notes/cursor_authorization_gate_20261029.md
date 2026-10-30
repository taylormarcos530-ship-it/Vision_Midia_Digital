# Checklist de segurança — RPC de cursor (homologação)

Estado: BLOQUEADO para implantação. Homologação jmiuitrrhtaeyrpuyohk não possui private.is_company_member(uuid) nem RPCs de playback; tabelas e colunas diferem de produção.

## Testes obrigatórios antes de liberar
1. Restaurar somente esquema compatível em projeto de homologação, por migrações revisadas, sem importar dados reais.
2. Verificar assinatura, tipo, ordem e semântica das colunas contra a função original de produção. Corrigir divergências antes de executar DDL.
3. Confirmar privilégios mínimos: REVOKE EXECUTE FROM PUBLIC, anon, authenticated no momento da criação (idealmente em uma transação); só GRANT para papel de teste necessário.
4. Executar como usuário autenticado membro da empresa A: dados apenas da A.
5. Executar como usuário autenticado não membro: erro 42501, mesmo conhecendo company_id, device_id ou cursor.
6. Executar como anon: permissão negada; verificar se função está exposta via Data API.
7. Validar paginação com timestamps empatados, limites, cursor incompleto, intervalo invertido e >366 dias.
8. Comparar todas as colunas com RPC antiga e validar performance sem degradar produção.

## Evidências
- SQL sintético read-only de 2.400 eventos executado em homologação: 500+500, 0 sobreposições, 500/500 preservados após nova reprodução simulada, 0 cruzamentos de empresa por predicado.
- Consulta ao pg_proc da homologação não encontrou funções de membership/playback.
- Testes reais de permissões, RLS e contrato da RPC: PENDENTES.

**Não executar qa/sql/playback_events_cursor_qa.sql nesta estrutura incompleta.**
