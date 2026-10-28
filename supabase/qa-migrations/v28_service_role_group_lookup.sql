-- Vision V28 QA: reviewed, non-automatic permission fix.
-- DO NOT execute in production before security review and backup.
-- This script is deliberately outside supabase/migrations, so deploy workflows
-- and migration runners do not apply it implicitly.
-- The device-gateway uses the server-side service_role (never the client key)
-- to resolve existing optional group assignments after validating device access.
-- Production currently responds 403/42501 for this read. These grants are
-- narrowly scoped to SELECT on the two group tables only.
GRANT SELECT ON TABLE public.device_group_members TO service_role;
GRANT SELECT ON TABLE public.device_groups TO service_role;

-- Read-only confirmation after authorized QA deployment:
-- SELECT has_table_privilege('service_role','public.device_group_members','SELECT') AS members_read,
--        has_table_privilege('service_role','public.device_groups','SELECT') AS groups_read;
