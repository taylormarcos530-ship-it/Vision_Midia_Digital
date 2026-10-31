-- VISION V30 Replay Guard: companion migration for disposable PostgreSQL 17 QA.
-- Staged V30 migration MUST be installed first. No cron and no automatic compaction.
-- A 128-bit truncation of SHA-256 makes the ledger ~15x smaller than raw playback.
-- Identity is device+client_event_id independent of original event timestamp.
-- Identities have NO expiry: late/offline replays always match; ledger grows over time.
-- Collision probability is negligible, but mathematically not zero.
DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM public.vision_playback_daily_archive_v30) THEN
  RAISE EXCEPTION 'V30 replay-guard retrofit refused: already archived events have no surviving IDs';
 END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS private.vision_playback_seen_v30 (
 fingerprint uuid PRIMARY KEY
);
REVOKE ALL ON TABLE private.vision_playback_seen_v30 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON TABLE private.vision_playback_seen_v30 TO service_role;

CREATE OR REPLACE FUNCTION private.vision_playback_identity_v30(p_device uuid,p_event text)
RETURNS uuid LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path='' AS $fn$
 SELECT substring(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_device::text || ':' || p_event,'UTF8')),'hex') from 1 for 32)::uuid
$fn$;
REVOKE ALL ON FUNCTION private.vision_playback_identity_v30(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.vision_playback_identity_v30(uuid,text) TO service_role;

-- The trigger runs before existing commercial-count AFTER INSERT triggers.
-- Serialize ingestion and archival for a device to avoid check-then-delete races.
CREATE OR REPLACE FUNCTION private.vision_playback_replay_guard_v30()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(93030,pg_catalog.hashtext(NEW.device_id::text));
 IF EXISTS(SELECT 1 FROM private.vision_playback_seen_v30
           WHERE fingerprint=private.vision_playback_identity_v30(NEW.device_id,NEW.client_event_id))
 THEN RETURN NULL; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.vision_playback_replay_guard_v30() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS vision_playback_replay_guard_v30 ON public.playback_logs;
CREATE TRIGGER vision_playback_replay_guard_v30
 BEFORE INSERT ON public.playback_logs FOR EACH ROW
 EXECUTE FUNCTION private.vision_playback_replay_guard_v30();

-- Replaces ONLY V30's opt-in compactor. Existing production RPC unchanged.

CREATE OR REPLACE FUNCTION private.vision_playback_compact_batch_v30(p_limit integer DEFAULT 250)
RETURNS TABLE (raw_removed bigint, groups_written bigint)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE v_days integer; v_ok boolean; v_device uuid; v_seen bigint;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 500';
  END IF;
  SELECT raw_days,
         enabled AND archive_verified_at IS NOT NULL
         AND reporting_verified_at IS NOT NULL AND offline_replay_verified_at IS NOT NULL
         AND dedupe_verified_at IS NOT NULL
    INTO v_days,v_ok
  FROM private.vision_playback_compaction_control_v30 WHERE id = 1;
  IF NOT COALESCE(v_ok,false) THEN
    RAISE EXCEPTION 'Vision compaction disabled: QA/backup/report/offline/dedupe approval missing';
  END IF;

  -- A writer and archiver must hold the same per-TV transaction lock BEFORE raw row locks.
  SELECT l.device_id INTO v_device FROM public.playback_logs l
    WHERE l.created_at < now()-(v_days*interval '1 day')
      AND l.started_at <= l.created_at+interval '10 minutes'
      AND l.started_at >= '2000-01-01'::timestamptz
    ORDER BY l.created_at,l.id LIMIT 1;
  IF v_device IS NULL THEN
    raw_removed:=0; groups_written:=0; RETURN NEXT; RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(93030,pg_catalog.hashtext(v_device::text));
  -- Reject clock-anomalous events: keep those available for investigation.
  -- Locks a small set so parallel workers cannot archive an event twice.
  WITH candidate AS MATERIALIZED (
    SELECT l.id
      FROM public.playback_logs l
     WHERE l.device_id = v_device
       AND l.created_at < now() - (v_days * interval '1 day')
       AND l.started_at <= l.created_at + interval '10 minutes'
       AND l.started_at >= '2000-01-01'::timestamptz
     ORDER BY l.created_at, l.id LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), removed AS (
    DELETE FROM public.playback_logs l
    USING candidate c WHERE l.id = c.id
    RETURNING l.*
  ), remembered AS (
    INSERT INTO private.vision_playback_seen_v30(fingerprint)
    SELECT private.vision_playback_identity_v30(r.device_id,r.client_event_id)
    FROM removed r
    RETURNING fingerprint
  ), grouped AS MATERIALIZED (
    SELECT (r.started_at AT TIME ZONE COALESCE(c.timezone,'America/Sao_Paulo'))::date AS play_date,
      r.company_id,r.device_id,COALESCE(r.campaign_id::text,'') AS campaign_key,
      COALESCE(r.playlist_id::text,'') AS playlist_key,
      COALESCE(r.media_id::text,'') AS media_key,
      COALESCE(NULLIF(r.device_name,''),d.name,'TV removida')::text AS device_name,
      COALESCE(NULLIF(r.campaign_name,''),a.name,CASE WHEN r.campaign_id IS NULL THEN 'Conteúdo padrão' ELSE 'Campanha removida' END)::text AS campaign_name,
      COALESCE(NULLIF(r.playlist_name,''),p.name,'Playlist removida')::text AS playlist_name,
      COALESCE(NULLIF(r.media_name,''),m.name,'Mídia removida')::text AS media_name,
      count(*)::bigint AS started,
      count(*) FILTER (WHERE r.completed)::bigint AS completed,
      COALESCE(sum(r.duration_seconds),0)::numeric AS total_seconds,
      min(r.started_at) AS first_play,max(r.started_at) AS last_play
    FROM removed r
    LEFT JOIN public.companies c ON c.id=r.company_id
    LEFT JOIN public.devices d ON d.id=r.device_id AND d.company_id=r.company_id
    LEFT JOIN public.campaigns a ON a.id=r.campaign_id AND a.company_id=r.company_id
    LEFT JOIN public.playlists p ON p.id=r.playlist_id AND p.company_id=r.company_id
    LEFT JOIN public.media_assets m ON m.id=r.media_id AND m.company_id=r.company_id
    GROUP BY 1,2,3,4,5,6,7,8,9,10
  ), applied AS (
    INSERT INTO public.vision_playback_daily_archive_v30 AS dest
      (play_date,company_id,device_id,campaign_key,playlist_key,media_key,
       device_name,campaign_name,playlist_name,media_name,
       started,completed,total_seconds,first_play,last_play)
    SELECT play_date,company_id,device_id,campaign_key,playlist_key,media_key,
       device_name,campaign_name,playlist_name,media_name,
       started,completed,total_seconds,first_play,last_play FROM grouped
    ON CONFLICT (play_date,company_id,device_id,campaign_key,playlist_key,media_key,
                 device_name,campaign_name,playlist_name,media_name)
    DO UPDATE SET started=dest.started+EXCLUDED.started,
      completed=dest.completed+EXCLUDED.completed,
      total_seconds=dest.total_seconds+EXCLUDED.total_seconds,
      first_play=LEAST(dest.first_play,EXCLUDED.first_play),
      last_play=GREATEST(dest.last_play,EXCLUDED.last_play),
      last_compacted_at=now()
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM removed),(SELECT count(*) FROM applied),
         (SELECT count(*) FROM remembered)
    INTO raw_removed,groups_written,v_seen;
  IF raw_removed <> v_seen THEN
    RAISE EXCEPTION 'V30 dedupe ledger mismatch: % raw removed, % fingerprints',raw_removed,v_seen;
  END IF;
  RETURN NEXT;
END $fn$;
REVOKE ALL ON FUNCTION private.vision_playback_compact_batch_v30(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.vision_playback_compact_batch_v30(integer) TO service_role;


-- No compaction invocation, DELETE, ledger TTL, or production changes in this migration.
