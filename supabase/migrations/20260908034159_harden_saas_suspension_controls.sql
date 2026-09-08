create or replace function private.protect_company_platform_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and new.status is distinct from old.status then
    raise exception 'company_status_managed_by_platform' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_company_platform_status() from public, anon, authenticated;

drop trigger if exists companies_protect_platform_status on public.companies;
create trigger companies_protect_platform_status before update on public.companies for each row execute function private.protect_company_platform_status();

create or replace function private.enforce_company_writable_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare cid uuid;
begin
  cid := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  perform private.ensure_company_writable(cid);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.enforce_company_writable_row() from public, anon, authenticated;

drop trigger if exists playlists_company_writable on public.playlists;
create trigger playlists_company_writable before insert or update or delete on public.playlists for each row execute function private.enforce_company_writable_row();
drop trigger if exists playlist_items_company_writable on public.playlist_items;
create trigger playlist_items_company_writable before insert or update or delete on public.playlist_items for each row execute function private.enforce_company_writable_row();
drop trigger if exists device_playlist_assignments_company_writable on public.device_playlist_assignments;
create trigger device_playlist_assignments_company_writable before insert or update or delete on public.device_playlist_assignments for each row execute function private.enforce_company_writable_row();
drop trigger if exists campaign_devices_company_writable on public.campaign_devices;
create trigger campaign_devices_company_writable before insert or update or delete on public.campaign_devices for each row execute function private.enforce_company_writable_row();
