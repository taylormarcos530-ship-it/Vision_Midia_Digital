# Resultado dos testes locais — 2026-10-30

Branch: audit/playback-query-performance-20261030

Comando: `node --test tests/playback-batch-dedup.test.mjs`

Resultado da execução local do arquivo de testes: 5 PASS, 0 FAIL.

Cenários:
1. Duplicata no mesmo lote: PASS
2. 100 eventos distintos: PASS
3. Evento inválido seguido de reenvio válido: PASS
4. IDs vazios e datas inválidas: PASS
5. Escopo de deduplicação por lote: PASS

Limitação: os testes são um modelo comportamental copiado da lógica do gateway, não invocam diretamente a função de produção, não testam banco, rede, autenticação, contagem de relatórios ou desempenho. A validação integrada e a medição de redução de consumo permanecem pendentes.

Nenhum deploy, merge, migração ou alteração de TVs foi realizado.
