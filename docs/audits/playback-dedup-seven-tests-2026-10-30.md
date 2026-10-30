# Execução local dos sete testes — 2026-10-30

Comando: `node --test playback-batch-dedup.test.mjs`

Resultado real da execução Node.js: 7 PASS, 0 FAIL, 0 SKIP; duração total 76,730311 ms.

Cenários aprovados:
1. Primeiro evento por ID no lote
2. 100 eventos válidos distintos
3. Evento inválido seguido de válido
4. IDs vazios e datas inválidas
5. Escopo de deduplicação por requisição
6. Confirmação simulada da fila após sucesso
7. Preservação simulada da fila após falha

Escopo: execução de cópia local do teste comportamental da branch; sem Supabase, sem gateway real, sem medição de consumo, sem deploy. Não constitui aprovação para produção.

Branch: audit/playback-query-performance-20261030.
