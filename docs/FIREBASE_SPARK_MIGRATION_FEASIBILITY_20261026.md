# Vision Mídia Digital — viabilidade do Firebase Spark (26/10/2026)

> Documento de avaliação. Não executa migrações, alterações de dados, deploy ou atualização de APK.

## Resultado

Não existe substituição 1:1 gratuita do Supabase atual apenas com Firebase Spark.

| Componente Vision | Supabase existente | Firebase Spark (gratuito) |
|---|---|---|
| Cadastro/login | Supabase Auth | Firebase Authentication: possível, migração de contas necessária |
| Dados relacionais e regras multiempresa | PostgreSQL, RLS e SQL | Firestore: modelo NoSQL e regras novas, requer reimplementação |
| Fotos e vídeos | Storage bucket `vision-media` | Cloud Storage for Firebase **exige Blaze** desde 03/02/2026 |
| API de pareamento e acesso de dispositivos | Edge Functions | Cloud Functions indisponível no Spark |
| Painel/site | Vercel | Firebase Hosting disponível com cotas, mas hospedagem não substitui backend |
| APKs instalados | `config.js` incorporado ao APK | Precisaria de transição de URL/chaves ou atualização do aplicativo |

Fontes:
- https://firebase.google.com/pricing
- https://firebase.google.com/docs/firestore/pricing
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024

## Limites Firestore

Spark: 1 GiB de banco, 50.000 leituras de documentos/dia, 20.000 gravações/dia, 10 GiB de saída/mês (edição Standard; conforme preço atual).
A política isolada de tráfego reduz chamadas periódicas:
- comandos a cada 15 segundos: 5.760 chamadas/dia por TV
- manifesto a cada 60 segundos: 1.440 chamadas/dia por TV
- heartbeat a cada 90 segundos: 960 chamadas/dia por TV
- total teórico se todas 33 TVs conectadas 24h: 269.280 solicitações de rede/dia.

Solicitações de rede **não equivalem necessariamente a leituras Firestore**. Entretanto, se cada chamada provocar ao menos uma leitura, o limite Spark seria superado. Para viabilizar Firestore, projetar sincronização por notificações/alteração de versão, cache e consulta sob demanda, não transportar a política de polling literalmente.

## Rota de implementação sem contratar

1. Manter produção atual e branch isolada; homologar APK candidato da política de backoff em TV de testes antes de distribuição.
2. Definir backend experimental separado, apenas dados sintéticos inicialmente. Se usar Firebase, ele pode assumir Auth/Firestore, mas arquivos e funções precisam de outro provedor gratuito com quotas/termos verificados.
3. Inventariar e exportar com integridade os bancos (incluindo Auth), metadados do Storage, arquivos binários, Edge Functions, triggers, RLS e jobs. Preservar chaves e tokens em ambiente seguro, sem colocá-los no Git.
4. Recriar isolamento por empresa com regras de segurança e testes negativos de acesso cruzado. Recriar funções de pareamento/renovação/expiração/playlist/prova de exibição e assegurar auditoria.
5. Testar as TVs existentes sem troca brusca de endpoint; garantir fallback/cache offline e plano explícito de reversão.
6. Só considerar migração de produção após consistência de dados, teste real de APK e autorização separada.

## Regras inegociáveis

- Sem migração destrutiva, deploy, merge, cobrança ou publicação de APK por esta avaliação.
- Não desligar o Supabase atual, não desparear TVs e não apagar cache de mídia.
- Preservar a autenticação, bloqueio por vencimento, playlists, mídias, contagens e acesso do anunciante.
- A correção de rede em `player.js` não alcança APKs já instalados até uma atualização testada.
