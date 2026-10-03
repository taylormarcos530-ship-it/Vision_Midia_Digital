-- Prepared only. Do not apply without explicit release authorization.
-- Adds a safe Player-app restart command while preserving screenshot behavior.

alter table public.device_commands
  drop constraint if exists device_commands_type_check;

alter table public.device_commands
  add constraint device_commands_type_check
  check (command_type in ('screenshot', 'restart_player', 'sync_now', 'clear_cache', 'reload_programming'));

comment on constraint device_commands_type_check on public.device_commands is
  'Allowed remote Player commands. Commands operate only on the Vision Player; restart_player does not reboot the TV Box operating system.';

-- Keep one active maintenance command of each type per TV.
-- The Edge Functions still do a friendly pre-check; this index closes the
-- concurrent SELECT -> INSERT race atomically at the database boundary.
create unique index if not exists device_commands_active_maintenance_unique_idx
  on public.device_commands (company_id, device_id, command_type)
  where status in ('pending', 'sent')
    and command_type in ('restart_player', 'sync_now', 'clear_cache', 'reload_programming');

