grant select on public.playback_logs to authenticated;
revoke insert,update,delete on public.playback_logs from authenticated,anon;
revoke select,insert,update,delete on public.playback_logs from anon;
