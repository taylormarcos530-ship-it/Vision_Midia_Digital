-- Commercial staging only: permit deleting precisely matched synthetic revisions.
-- Never apply on Vision Mídia production. No migration of Vision Menu objects.
DO $guard$
BEGIN
 IF (SELECT project_ref FROM private.vision_staging_guard LIMIT 1)
       IS DISTINCT FROM 'jmiuitrrhtaeyrpuyohk'
 OR to_regclass('vision_menu_lab.vision_menu_drafts') IS NULL
 OR to_regclass('public.vision_commercial_revisions') IS NULL
 OR to_regclass('public.vision_commercial_campaigns') IS NULL
 THEN RAISE EXCEPTION 'commercial_staging_cleanup_only'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION private.vision_revision_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $body$
BEGIN
 -- UPDATE stays immutable in all cases. DELETE is permitted only for a specifically
 -- generated lab campaign whose campaign nonce matches its revision checksum.
 IF TG_OP='DELETE'
   AND (SELECT project_ref FROM private.vision_staging_guard LIMIT 1)='jmiuitrrhtaeyrpuyohk'
   AND OLD.name='LAB ONLY - 1px'
   AND OLD.media_type='image'
   AND OLD.checksum ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND OLD.source_storage_path ~* '^qa-commercial-probe/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]png$'
   AND OLD.storage_path ~* '^commercial-ads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]png$'
   AND EXISTS (
     SELECT 1 FROM public.vision_commercial_campaigns c
     WHERE c.id=OLD.campaign_id
       AND c.name='LAB-VIRTUAL-' || OLD.checksum
   )
 THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'immutable_revision';
END
$body$;
