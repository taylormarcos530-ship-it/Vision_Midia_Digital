-- Prepared only. Do not apply without explicit release authorization.
-- Adds a safe Player-app restart command while preserving screenshot behavior.

alter table public.device_commands
  drop constraint if exists device_commands_type_check;

alter table public.device_commands
  add constraint device_commands_type_check
  check (command_type in ('screenshot', 'restart_player', 'sync_now', 'clear_cache', 'reload_programming'));

comment on constraint device_commands_type_check on public.device_commands is
  'Allowed remote Player commands. Commands operate only on the Vision Player; restart_player does not reboot the TV Box operating system.';
