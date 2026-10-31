-- QA ONLY: use after synthetic fixture + V30 staging/guards in a fresh
-- LOCAL Supabase PostgreSQL 17. Never point PGHOST at production.
-- This isolates actual Supabase Auth JWT-backed RLS from fixture test settings.

CREATE TABLE private.v30_qa_membership (
 user_id uuid NOT NULL,
 company_id uuid NOT NULL,
 PRIMARY KEY(user_id,company_id)
);
REVOKE ALL ON private.v30_qa_membership FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.is_company_member(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
 SELECT EXISTS (
   SELECT 1 FROM private.v30_qa_membership m
   WHERE m.user_id=auth.uid() AND m.company_id=p_company_id
 )
$fn$;
REVOKE ALL ON FUNCTION private.is_company_member(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.is_company_member(uuid) TO authenticated,service_role;

ALTER TABLE public.playback_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY v30_qa_playback_select ON public.playback_logs
FOR SELECT TO authenticated
USING ((SELECT private.is_company_member(company_id)));
REVOKE ALL ON public.playback_logs FROM anon,authenticated;
GRANT SELECT ON public.playback_logs TO authenticated;
GRANT ALL ON public.playback_logs TO service_role;
GRANT SELECT ON public.vision_playback_daily_archive_v30 TO authenticated;
GRANT ALL ON public.vision_playback_daily_archive_v30 TO service_role;
GRANT SELECT ON public.devices,public.companies,public.media_assets,public.campaigns,public.playlists
 TO authenticated,service_role;
GRANT ALL ON public.device_credentials, public.company_subscriptions,
 public.device_pairing_requests TO service_role;
GRANT SELECT,UPDATE ON private.vision_playback_compaction_control_v30 TO service_role;
GRANT SELECT,INSERT,UPDATE ON private.vision_playback_seen_segments_v30 TO service_role;

-- The two companies/devices/subscriptions are seeded once by
-- tests/v30-http-qa-fixture.sql, not repeated here.
DO $qa$
BEGIN
 IF (SELECT enabled FROM private.vision_playback_compaction_control_v30 WHERE id=1)
 THEN RAISE EXCEPTION 'QA should start with retention disabled'; END IF;
END $qa$;
