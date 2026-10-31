-- VISION V30 packed 128-bit replay fingerprints (QA ONLY, install after original guard).
-- This migration MUST NOT be applied to production without separate approval.
-- No deletion, cron, backfill, or retention activation is performed by installation.
-- Fingerprints are stored permanently; no bounded-size exact deduplication is possible
-- if arbitrary-late replays must remain recognizable forever.
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM public.vision_playback_daily_archive_v30)
    OR EXISTS(SELECT 1 FROM private.vision_playback_seen_v30)
 THEN
   RAISE EXCEPTION 'REFUSED: existing compacted data or old ledger entries require a lossless migration';
 END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS private.vision_playback_seen_packed_v30(
 device_id uuid NOT NULL,
 shard smallint NOT NULL CHECK(shard BETWEEN 0 AND 255),
 fingerprints bytea NOT NULL CHECK(octet_length(fingerprints) > 0 AND octet_length(fingerprints)%16=0),
 PRIMARY KEY(device_id,shard)
);
REVOKE ALL ON TABLE private.vision_playback_seen_packed_v30 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE private.vision_playback_seen_packed_v30 TO service_role;

CREATE OR REPLACE FUNCTION private.vision_playback_fingerprint_bytes_v30(p_device uuid,p_event text)
RETURNS bytea LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path='' AS $fn$
 SELECT pg_catalog.substring(
   pg_catalog.sha256(pg_catalog.convert_to(p_device::text || ':' || p_event,'UTF8'))
 FROM 1 FOR 16)
$fn$;
REVOKE ALL ON FUNCTION private.vision_playback_fingerprint_bytes_v30(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.vision_playback_fingerprint_bytes_v30(uuid,text) TO service_role;

-- Always compare aligned 16-byte entries, not a substring that could straddle hashes.
CREATE OR REPLACE FUNCTION private.vision_playback_packed_contains_v30(p_packed bytea,p_hash bytea)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path='' AS $fn$
DECLARE lo int:=0; hi int; m int; v bytea;
BEGIN
 IF octet_length(p_hash)<>16 OR octet_length(p_packed)%16<>0
 THEN RAISE EXCEPTION 'Invalid V30 packed fingerprint length'; END IF;
 hi:=octet_length(p_packed)/16-1;
 WHILE lo<=hi LOOP
   m:=(lo+hi)/2;
   v:=pg_catalog.substring(p_packed FROM (m*16+1) FOR 16);
   IF v=p_hash THEN RETURN true; END IF;
   IF v<p_hash THEN lo:=m+1; ELSE hi:=m-1; END IF;
 END LOOP;
 RETURN false;
END $fn$;
REVOKE ALL ON FUNCTION private.vision_playback_packed_contains_v30(bytea,bytea) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.vision_playback_packed_contains_v30(bytea,bytea) TO service_role;

-- Merge two sorted blobs atomically; reject collisions/duplicate ledger identities.
CREATE OR REPLACE FUNCTION private.vision_playback_merge_packed_v30(p_old bytea,p_new bytea)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $fn$
DECLARE v_data bytea; n bigint; distinct_n bigint;
BEGIN
 IF octet_length(p_old)%16<>0 OR octet_length(p_new)%16<>0
 THEN RAISE EXCEPTION 'Invalid V30 packed data length'; END IF;
 WITH all_hashes AS (
  SELECT pg_catalog.substring(p_old FROM i*16+1 FOR 16) AS h
    FROM pg_catalog.generate_series(0,octet_length(p_old)/16-1) i
  UNION ALL
  SELECT pg_catalog.substring(p_new FROM i*16+1 FOR 16) AS h
    FROM pg_catalog.generate_series(0,octet_length(p_new)/16-1) i
 )
 SELECT pg_catalog.string_agg(h,''::bytea ORDER BY h),count(*),count(DISTINCT h)
 INTO v_data,n,distinct_n FROM all_hashes;
 IF n<>distinct_n THEN
   RAISE EXCEPTION 'V30 duplicate fingerprint while merging packed ledger';
 END IF;
 RETURN COALESCE(v_data,''::bytea);
END $fn$;
REVOKE ALL ON FUNCTION private.vision_playback_merge_packed_v30(bytea,bytea) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.vision_playback_merge_packed_v30(bytea,bytea) TO service_role;

-- Keep the original advisory lock used by the ingestion and archive processes.
-- BEFORE INSERT prevents replayed commercial AFTER INSERT triggers from double counting.
CREATE OR REPLACE FUNCTION private.vision_playback_replay_guard_v30()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_hash bytea; v_packed bytea;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(93030,pg_catalog.hashtext(NEW.device_id::text));
 v_hash:=private.vision_playback_fingerprint_bytes_v30(NEW.device_id,NEW.client_event_id);
 SELECT fingerprints INTO v_packed FROM private.vision_playback_seen_packed_v30
  WHERE device_id=NEW.device_id AND shard=pg_catalog.get_byte(v_hash,0);
 IF FOUND AND private.vision_playback_packed_contains_v30(v_packed,v_hash)
 THEN RETURN NULL; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.vision_playback_replay_guard_v30() FROM PUBLIC,anon,authenticated;

-- Replaces only the opt-in V30 archiver; retains its guardrails and raw row locks.
CREATE OR REPLACE FUNCTION private.vision_playback_compact_batch_v30(p_limit integer DEFAULT 250)
RETURNS TABLE (raw_removed bigint, groups_written bigint)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE v_days integer; v_ok boolean; v_device uuid; v_seen bigint; v_buckets bigint;
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
  ), hash_batch AS MATERIALIZED (
    SELECT h.device_id, pg_catalog.get_byte(h.fingerprint,0) AS shard,
           pg_catalog.string_agg(h.fingerprint,''::bytea ORDER BY h.fingerprint) AS fingerprints,
           count(*)::bigint AS n
    FROM (SELECT r.device_id,
       private.vision_playback_fingerprint_bytes_v30(r.device_id,r.client_event_id) AS fingerprint
       FROM removed r) h
    GROUP BY h.device_id, pg_catalog.get_byte(h.fingerprint,0)
  ), remembered AS (
    INSERT INTO private.vision_playback_seen_packed_v30 AS dest(device_id,shard,fingerprints)
    SELECT device_id,shard,fingerprints FROM hash_batch
    ON CONFLICT(device_id,shard) DO UPDATE
      SET fingerprints=private.vision_playback_merge_packed_v30(dest.fingerprints,EXCLUDED.fingerprints)
    RETURNING 1
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
         (SELECT COALESCE(sum(n),0)::bigint FROM hash_batch),
         (SELECT count(*)::bigint FROM remembered)
    INTO raw_removed,groups_written,v_seen,v_buckets;
  IF raw_removed <> v_seen OR (raw_removed > 0 AND v_buckets = 0) THEN
    RAISE EXCEPTION 'V30 packed ledger mismatch: % raw removed, % fingerprints, % buckets',raw_removed,v_seen,v_buckets;
  END IF;
  RETURN NEXT;
END $fn$;
REVOKE ALL ON FUNCTION private.vision_playback_compact_batch_v30(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.vision_playback_compact_batch_v30(integer) TO service_role;


-- No compaction invocation, DELETE, ledger TTL, or production changes in this migration.
