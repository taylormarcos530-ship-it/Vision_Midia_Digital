# Vision Menu Digital — checkpoint MVP 03 (aceite de laboratório)

Branch exclusiva: `feature/vision-menu-digital-mvp-isolated`.
Base imutável: `f81324089265c6ee46a623c3a9523b789a96256b`.
Checkpoint MVP 02: `025d03b0d9dad1bf58d5494eeee001a9e8524beb`.

## O que está pronto

- Template fixo 16:9 com mapa de regiões, oito produtos por grupo e rotação configurável 5/10/15 segundos.
- Editor de preços, nomes, ordem, ativo/inativo e logo, com prévia responsiva.
- Vídeo local independente e permanente, sem reconstruir o elemento ao trocar preços.
- Protótipo sem integração a Supabase, playlists, TVs reais, Android ou campanhas.
- MVP 03: seis novos testes de aceitação. Executado localmente: 16/16 testes Node (10 anteriores + 6 novos), PASS.
- No MVP 02, 21 verificações isoladas no Chromium haviam sido registradas, mas NÃO representam validação HTTP nativa, TV real ou regressão completa do produto.

## Limite do ambiente nesta rodada

Tentativa de abrir `http://127.0.0.1` no Chromium devolveu `ERR_BLOCKED_BY_ADMINISTRATOR` inclusive sem proxy. Portanto a validação HTTP com módulos nativos fica **não executada com sucesso**, e não se interpreta o bloqueio como defeito do módulo. Em um ambiente normal com acesso a localhost, repetir apenas esse teste, não toda a auditoria.

## Definição de pronto — sem ciclo infinito

1. **Gate A — Protótipo demonstrável (feito no laboratório):** layout, controle de produtos, logo, loop do vídeo e ausência de integração produtiva. Pendência: aprovação visual do responsável para uso da arte final e teste HTTP nativo em ambiente que permita localhost.
2. **Gate B — Integração em homologação (não iniciada, requer autorização):** configuração por empresa/TV, RLS de verdade, importação da biblioteca, agenda comercial e cache/fail-closed. Requer banco e player de testes, nunca producao; critérios: isolamento A/B, prioridade de campanhas preservada, desligar retorna playlist e preço não reinicia vídeo.
3. **Gate C — Piloto e liberação (não iniciada, requer autorização):** 1 TV de teste autorizada, reprodução offline/reinício/reconexão, telemetria/prova de exibição sem falsear completude, regressão da versão real de player/APK. Somente após aprovação explícita pode ir para produção.

Não abrir novos MVPs nem auditar novamente itens já aprovados sem falha reproduzida. Cada gate é aprovado uma vez, com evidência, ou fica pendente com bloqueio concreto. MVP de laboratório **não equivale a produto pronto para clientes**.

## Restrições preservadas

Sem merge, deploy, migrations, publicação Edge Functions ou alterações de player, APK, campanhas, playlists, dados de produção e SQL-01/SQL-02. Todo o trabalho novo fica sob `vision-menu-lab/`.

