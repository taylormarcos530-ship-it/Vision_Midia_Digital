# Resultado executado — paginação sintética em homologação

Projeto: jmiuitrrhtaeyrpuyohk (Vision Mídia Digital — Homologação)
Data: 2026-10-29
Método: SQL SELECT com CTE generate_series, sem DDL/DML e sem dados reais.

Fixture: 2.400 eventos fictícios, 1.200 por empresa, UUIDs determinísticos, timestamps com empates (g/3).
Primeira página: 500
Segunda página por cursor (started_at,id): 500
IDs sobrepostos: 0
Comparação da segunda página com uma reprodução nova mais recente simulada por UNION ALL: 500/500 IDs preservados
Nova reprodução na segunda página: 0
Vazamento de IDs da outra empresa no resultado filtrado: 0

Escopo: teste da expressão SQL de keyset e isolamento por predicado company_id. NÃO executou a RPC de QA, NÃO testou auth.uid(), private.is_company_member, RLS ou GRANTs. Não há prova de segurança de usuário ainda.

Produção não alterada. Nenhuma tabela criada na homologação.
