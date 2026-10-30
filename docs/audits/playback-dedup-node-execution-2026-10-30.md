# Execução real dos testes de deduplicação — 2026-10-30

Comando executado em ambiente local isolado (Node.js v22.16.0):
`node --test /mnt/data/vision-audit/playback-batch-dedup.test.mjs`

Fonte do teste: `tests/playback-batch-dedup.test.mjs` da branch `audit/playback-query-performance-20261030`. O conteúdo foi transcrito para arquivo local de execução; não houve deploy nem uso do banco.

Resultado TAP:
- tests: 7
- pass: 7
- fail: 0
- cancelled: 0
- skipped: 0
- duration: ~118 ms

Cenários: repetição no lote, 100 eventos únicos, retry após evento inválido, rejeição de IDs/datas inválidos, escopo por lote, sucesso e falha de flush da fila.

Limitação: **modelo comportamental**, não executa o gateway Deno real nem Supabase; não comprova consumo, latência, RLS ou contagem de produção. Próximo passo é teste de integração isolado com mocks/DB descartável.
