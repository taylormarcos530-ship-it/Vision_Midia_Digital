-- Prepared for official deploy; not applied by this preview block.
alter table public.platform_public_config
  add column if not exists login_image_path text,
  add column if not exists login_image_fit text not null default 'cover',
  add column if not exists login_image_position text not null default 'center',
  add column if not exists login_image_overlay smallint not null default 42,
  add column if not exists login_image_title text not null default 'Sua operação visual, organizada em um só lugar.',
  add column if not exists login_image_subtitle text not null default 'Gerencie telas, conteúdos, playlists e campanhas com controle profissional.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'platform_public_config_login_image_fit_check'
  ) then
    alter table public.platform_public_config
      add constraint platform_public_config_login_image_fit_check
      check (login_image_fit in ('cover','contain'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'platform_public_config_login_image_position_check'
  ) then
    alter table public.platform_public_config
      add constraint platform_public_config_login_image_position_check
      check (login_image_position in ('center','top','bottom','left','right'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'platform_public_config_login_image_overlay_check'
  ) then
    alter table public.platform_public_config
      add constraint platform_public_config_login_image_overlay_check
      check (login_image_overlay between 0 and 80);
  end if;
end
$$;
