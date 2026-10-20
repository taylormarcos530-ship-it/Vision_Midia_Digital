-- Enable remote APK update requests after new signed Android build is verified.
ALTER TABLE public.device_commands DROP CONSTRAINT IF EXISTS device_commands_type_check;
ALTER TABLE public.device_commands ADD CONSTRAINT device_commands_type_check CHECK (command_type IN ('screenshot','restart_player','sync_now','clear_cache','reload_programming','update_apk'));
