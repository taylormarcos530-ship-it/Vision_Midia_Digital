-- READ-ONLY production/staging schema compatibility preflight for cursor RPC.
-- Run independently on each project. No DDL or data mutations.
with required(rel,col) as (
 values ('playback_logs','company_id'),('playback_logs','started_at'),('playback_logs','id'),
 ('playback_logs','duration_seconds'),('playback_logs','campaign_id'),('playback_logs','playlist_id'),
 ('playback_logs','device_name'),('playback_logs','campaign_name'),('playback_logs','playlist_name'),
 ('playback_logs','media_name'),('companies','timezone'),('devices','company_id'),
 ('campaigns','company_id'),('playlists','company_id'),('media_assets','company_id')
), checks as (
 select r.rel,r.col,exists (
  select 1 from information_schema.columns c
  where c.table_schema='public' and c.table_name=r.rel and c.column_name=r.col
 ) as present from required r
)
select rel,col,present from checks order by rel,col;

select exists (
 select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname='is_company_member'
 and pg_get_function_identity_arguments(p.oid)='p_company_id uuid'
) as expected_membership_signature_present;

-- All required fields and membership guard must be present before testing
-- the 14-column cursor RPC in a parity-matched isolated environment.
