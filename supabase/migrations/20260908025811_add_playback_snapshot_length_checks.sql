alter table public.playback_logs
  add constraint playback_logs_device_name_length check (device_name is null or char_length(device_name) <= 120),
  add constraint playback_logs_campaign_name_length check (campaign_name is null or char_length(campaign_name) <= 180),
  add constraint playback_logs_playlist_name_length check (playlist_name is null or char_length(playlist_name) <= 120),
  add constraint playback_logs_media_name_length check (media_name is null or char_length(media_name) <= 180);
