-- Keep the existing Master and company boundaries; call the existing
-- current-user helper that authenticated users are allowed to execute.
-- Do not grant callers access to private.is_platform_admin(uuid).
alter policy platform_player_branding_master_select on public.platform_player_branding
  using ((select public.current_user_is_platform_admin()));
alter policy platform_player_branding_master_insert on public.platform_player_branding
  with check ((select public.current_user_is_platform_admin()));
alter policy platform_player_branding_master_update on public.platform_player_branding
  using ((select public.current_user_is_platform_admin()))
  with check ((select public.current_user_is_platform_admin()));
alter policy vision_media_platform_branding_insert on storage.objects
  with check (bucket_id='vision-media' and (storage.foldername(name))[1]='_platform' and (select public.current_user_is_platform_admin()));
alter policy vision_media_platform_branding_select on storage.objects
  using (bucket_id='vision-media' and (storage.foldername(name))[1]='_platform' and (select public.current_user_is_platform_admin()));
alter policy vision_media_platform_branding_delete on storage.objects
  using (bucket_id='vision-media' and (storage.foldername(name))[1]='_platform' and (select public.current_user_is_platform_admin()));
