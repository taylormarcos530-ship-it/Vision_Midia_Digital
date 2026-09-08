update public.playback_logs l
set
  device_name = coalesce(l.device_name,(select d.name from public.devices d where d.company_id=l.company_id and d.id=l.device_id),'TV removida'),
  campaign_name = coalesce(l.campaign_name,(select c.name from public.campaigns c where c.company_id=l.company_id and c.id=l.campaign_id),case when l.campaign_id is null then 'Conteúdo padrão' else 'Campanha removida' end),
  playlist_name = coalesce(l.playlist_name,(select p.name from public.playlists p where p.company_id=l.company_id and p.id=l.playlist_id),case when l.playlist_id is null then null else 'Playlist removida' end),
  media_name = coalesce(l.media_name,(select m.name from public.media_assets m where m.company_id=l.company_id and m.id=l.media_id),case when l.media_id is null then null else 'Mídia removida' end)
where l.device_name is null or l.campaign_name is null or (l.playlist_id is not null and l.playlist_name is null) or (l.media_id is not null and l.media_name is null);
