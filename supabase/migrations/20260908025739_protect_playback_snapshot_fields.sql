create or replace function private.protect_playback_audit_fields() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.company_id is distinct from old.company_id or new.device_id is distinct from old.device_id or new.client_event_id is distinct from old.client_event_id or new.started_at is distinct from old.started_at or new.device_name is distinct from old.device_name or new.campaign_name is distinct from old.campaign_name or new.playlist_name is distinct from old.playlist_name or new.media_name is distinct from old.media_name) then
    raise exception 'playback audit identity fields are immutable';
  end if;
  return new;
end; $$;
drop trigger if exists playback_logs_protect_audit_fields on public.playback_logs;
create trigger playback_logs_protect_audit_fields before update on public.playback_logs for each row execute function private.protect_playback_audit_fields();
