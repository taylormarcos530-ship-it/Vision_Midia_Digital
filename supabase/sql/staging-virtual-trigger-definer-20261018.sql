-- STAGING ONLY. Correct service_role execution context of the existing
-- narrow lab revision cleanup trigger. No production environments allowed.
DO $guard$
DECLARE owner_name text; was_definer boolean; def text;
BEGIN
 IF (SELECT project_ref FROM private.vision_staging_guard LIMIT 1)
    IS DISTINCT FROM 'jmiuitrrhtaeyrpuyohk'
 OR to_regclass('vision_menu_lab.vision_menu_drafts') IS NULL
 THEN RAISE EXCEPTION 'virtual_staging_only'; END IF;
 SELECT rol.rolname,p.prosecdef,pg_get_functiondef(p.oid) INTO owner_name,was_definer,def
 FROM pg_proc p JOIN pg_roles rol ON rol.oid=p.proowner
 WHERE p.oid='private.vision_revision_immutable()'::regprocedure;
 IF owner_name IS DISTINCT FROM 'postgres'
 OR def NOT LIKE '%c.name=''LAB-VIRTUAL-'' || OLD.checksum%'
 OR def NOT LIKE '%RAISE EXCEPTION ''immutable_revision''%'
 THEN RAISE EXCEPTION 'wrong_immutable_trigger'; END IF;
END $guard$;
-- Preserve the original trigger and its strict verification of synthetic revisions.
-- Grant no permissions on private.vision_staging_guard to service_role.
ALTER FUNCTION private.vision_revision_immutable() SECURITY DEFINER;
