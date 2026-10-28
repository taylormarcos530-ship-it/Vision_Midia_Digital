-- Non-destructive staging for Vision playback audit retention.
-- No DELETE, DROP, TRUNCATE or cron schedule is installed by this migration.
-- User must approve retention period and verify external archive/backup first.
CREATE TABLE IF NOT EXISTS private.playback_retention_policy (
    policy_id integer PRIMARY KEY DEFAULT 1 CHECK (policy_id = 1),
    retention_days integer NOT NULL DEFAULT 180 CHECK (retention_days BETWEEN 30 AND 3650),
    deletion_enabled boolean NOT NULL DEFAULT false,
    archive_verified_at timestamptz,
    policy_updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.playback_retention_policy(policy_id, retention_days, deletion_enabled)
VALUES (1, 180, false)
ON CONFLICT (policy_id) DO NOTHING;

REVOKE ALL ON TABLE private.playback_retention_policy FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE private.playback_retention_policy TO service_role;

-- Preview only, no actual deletion. Raw playback events remain untouched.
CREATE OR REPLACE FUNCTION private.preview_playback_retention(p_days integer DEFAULT 180)
RETURNS TABLE (retention_days integer, cutoff_at timestamptz, eligible_records bigint,
               oldest_event_at timestamptz, newest_event_at timestamptz,
               history_table_bytes bigint, history_indexes_bytes bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT p_days,
         now() - (p_days * interval '1 day'),
         (SELECT count(*) FROM public.playback_logs WHERE started_at < now() - (p_days * interval '1 day')),
         (SELECT min(started_at) FROM public.playback_logs),
         (SELECT max(started_at) FROM public.playback_logs),
         pg_relation_size('public.playback_logs'::regclass),
         pg_indexes_size('public.playback_logs'::regclass)
  WHERE p_days BETWEEN 30 AND 3650
$$;
REVOKE ALL ON FUNCTION private.preview_playback_retention(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.preview_playback_retention(integer) TO service_role;
