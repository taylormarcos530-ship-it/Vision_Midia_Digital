-- Fix privileges for the Master-controlled Player branding table.
-- RLS still restricts authenticated writes to platform admins; the Player reads it through device-bootstrap using service_role.
grant select, insert, update on table public.platform_player_branding to authenticated;
grant select, insert, update, delete on table public.platform_player_branding to service_role;
