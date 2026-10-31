-- Disposable QA ONLY. Extends already-created v30-http-qa-fixture.sql.
ALTER TABLE public.devices
 ADD COLUMN IF NOT EXISTS status text DEFAULT 'online',
 ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now(),
 ADD COLUMN IF NOT EXISTS app_version text,
 ADD COLUMN IF NOT EXISTS player_version text,
 ADD COLUMN IF NOT EXISTS apk_version text,
 ADD COLUMN IF NOT EXISTS reported_orientation text,
 ADD COLUMN IF NOT EXISTS screen_width integer,
 ADD COLUMN IF NOT EXISTS screen_height integer,
 ADD COLUMN IF NOT EXISTS storage_free_mb integer,
 ADD COLUMN IF NOT EXISTS last_sync_at timestamptz,
 ADD COLUMN IF NOT EXISTS current_campaign_id uuid,
 ADD COLUMN IF NOT EXISTS current_playlist_id uuid,
 ADD COLUMN IF NOT EXISTS current_media_id uuid,
 ADD COLUMN IF NOT EXISTS cache_items integer DEFAULT 0,
 ADD COLUMN IF NOT EXISTS cache_bytes bigint DEFAULT 0,
 ADD COLUMN IF NOT EXISTS playback_queue_size integer DEFAULT 0,
 ADD COLUMN IF NOT EXISTS event_queue_size integer DEFAULT 0;
CREATE TABLE public.device_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL, device_id uuid NOT NULL,
 command_type text NOT NULL, status text NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,completed_at timestamptz,
 error_message text,result jsonb
);
CREATE TABLE public.device_heartbeats (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL, device_id uuid NOT NULL,
 received_at timestamptz DEFAULT now(),
 app_version text,screen_width integer,screen_height integer,
 orientation text,storage_free_mb integer,details jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE private.v30_bundle_write_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 table_name text NOT NULL,
 operation text NOT NULL,
 company_id uuid,
 device_id uuid,
 logged_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION private.v30_bundle_write_audit_fn()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO private.v30_bundle_write_audit(table_name,operation,company_id,device_id)
 VALUES(TG_TABLE_NAME,TG_OP,
  (to_jsonb(NEW)->>'company_id')::uuid,
  (to_jsonb(NEW)->>'device_id')::uuid);
 RETURN NEW;
END $$;
CREATE TRIGGER audit_bundle_credentials AFTER UPDATE ON public.device_credentials
 FOR EACH ROW EXECUTE FUNCTION private.v30_bundle_write_audit_fn();
CREATE TRIGGER audit_bundle_pairing AFTER UPDATE ON public.device_pairing_requests
 FOR EACH ROW EXECUTE FUNCTION private.v30_bundle_write_audit_fn();
CREATE TRIGGER audit_bundle_devices AFTER UPDATE ON public.devices
 FOR EACH ROW EXECUTE FUNCTION private.v30_bundle_write_audit_fn();
CREATE TRIGGER audit_bundle_commands AFTER UPDATE ON public.device_commands
 FOR EACH ROW EXECUTE FUNCTION private.v30_bundle_write_audit_fn();
CREATE TRIGGER audit_bundle_heartbeats AFTER INSERT ON public.device_heartbeats
 FOR EACH ROW EXECUTE FUNCTION private.v30_bundle_write_audit_fn();
GRANT SELECT,INSERT,UPDATE,DELETE ON public.device_commands,public.device_heartbeats TO service_role;
GRANT SELECT ON private.v30_bundle_write_audit TO service_role;
GRANT INSERT ON private.v30_bundle_write_audit TO service_role;
GRANT USAGE ON SEQUENCE private.v30_bundle_write_audit_id_seq TO service_role;
-- Never add these QA-only audit objects to production.
