# Compatibilidade do Supabase de homologação — 2026-10-30

Projetos examinados (somente leitura):
- Produção: fpadgedrgcxrrqflzhjt
- Homologação: jmiuitrrhtaeyrpuyohk (ACTIVE_HEALTHY)

Constatações:
- Homologação possui public.companies, devices, media_assets e playback_logs.
- Não foram encontradas public.campaigns e public.playlists.
- public.playback_logs na homologação tem: id, device_id, client_event_id, media_id, started_at, ended_at, completed, created_at.
- Campos exigidos pelo gateway de produção e ausentes: company_id, campaign_id, playlist_id, duration_seconds, device_name, campaign_name, playlist_name, media_name.
- Contagem de playback_logs na homologação: 0.
- Portanto o gateway atual não é compatível com esse esquema; não implantar nem executar o gateway atual lá sem migração revisada.

Próximos passos, sem tocar na produção:
1. Inventariar constraints, RLS, tabelas relacionadas e migrações da homologação.
2. Decidir entre migração aditiva compatível e banco temporário isolado, verificando consumidores existentes.
3. Criar dados sintéticos de TV/empresa/mídia, sem copiar dados de produção.
4. Executar teste real de lote com duplicatas e reenvio, comparar linhas e confirmações.
5. Medir latência e chamadas em condições equivalentes antes/depois.

Nenhuma mudança de banco, deploy, merge ou TV realizada nesta auditoria.
