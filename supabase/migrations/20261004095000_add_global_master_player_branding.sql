-- Global Vision Player branding: Master-controlled and shared by every client Player.
create table if not exists public.platform_player_branding (
  id smallint primary key default 1 check (id = 1),
  title text,
  message text,
  splash_path text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.platform_player_branding enable row level security;
create or replace function public.current_user_is_platform_admin()
returns boolean language sql stable security definer set search_path=''
as $$ select private.is_platform_admin((select auth.uid())); $$;
grant execute on function public.current_user_is_platform_admin() to authenticated;
create policy platform_player_branding_master_select on public.platform_player_branding for select to authenticated using (private.is_platform_admin());
create policy platform_player_branding_master_insert on public.platform_player_branding for insert to authenticated with check (private.is_platform_admin());
create policy platform_player_branding_master_update on public.platform_player_branding for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy vision_media_platform_branding_insert on storage.objects for insert to authenticated with check (bucket_id='vision-media' and (storage.foldername(name))[1]='_platform' and private.is_platform_admin());
create policy vision_media_platform_branding_select on storage.objects for select to authenticated using (bucket_id='vision-media' and (storage.foldername(name))[1]='_platform' and private.is_platform_admin());
create policy vision_media_platform_branding_delete on storage.objects for delete to authenticated using (bucket_id='vision-media' and (storage.foldername(name))[1]='_platform' and private.is_platform_admin());
