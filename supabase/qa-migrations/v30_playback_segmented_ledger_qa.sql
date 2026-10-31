-- Vision V30 segmented hash ledger, QA ONLY: execute AFTER V30 packed migration.
-- This script IS NOT for production; no automatic cleanup, no cron and no raw deletion.
-- Exact identity is SHA256(device_id:event_id) truncated to 16 bytes; collisions
-- are astronomically unlikely, not mathematically impossible.
-- Records retained indefinitely: strict arbitrary-late replay protection implies
-- UNBOUNDED total storage as the number of unique events grows.
DO $v30$
BEGIN
 IF EXISTS(SELECT 1 FROM public.vision_playback_daily_archive_v30)
    OR EXISTS(SELECT 1 FROM private.vision_playback_seen_v30)
    OR EXISTS(SELECT 1 FROM private.vision_playback_seen_packed_v30)
 THEN
   RAISE EXCEPTION 'Refusing V30 segmented retrofit: lossless ledger migration is required';
 END IF;
END $v30$;

CREATE TABLE private.vision_playback_seen_segments_v30(
 device_id uuid NOT NULL,
 shard smallint NOT NULL CHECK(shard BETWEEN 0 AND 255),
 segment_no integer NOT NULL CHECK(segment_no>0),
 fingerprint_count smallint NOT NULL CHECK(fingerprint_count BETWEEN 1 AND 64),
 fingerprints bytea NOT NULL CHECK (
   octet_length(fingerprints)=fingerprint_count*16
 ),
 PRIMARY KEY(device_id,shard,segment_no)
);
REVOKE ALL ON private.vision_playback_seen_segments_v30 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON private.vision_playback_seen_segments_v30 TO service_role;

-- One device lock is shared with the player's BEFORE INSERT check and archiver.
-- Each row contains at most 64 hashes (1024 payload bytes, below TOAST threshold).
CREATE OR REPLACE FUNCTION private.vision_playback_segment_add_v30(
 p_device uuid,p_shard integer,p_packed bytea
) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE
 v_total integer; v_i integer; v_take integer; v_seq integer; v_count integer;
 v_remaining integer; v_chunk bytea; v_hash bytea; v_prev bytea:=NULL; v_added bigint:=0;
BEGIN
 IF p_device IS NULL OR p_shard NOT BETWEEN 0 AND 255
    OR p_packed IS NULL OR pg_catalog.octet_length(p_packed)=0
    OR pg_catalog.octet_length(p_packed)%16<>0 THEN
   RAISE EXCEPTION 'Invalid V30 segment input';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(93030,pg_catalog.hashtext(p_device::text));
 v_total:=pg_catalog.octet_length(p_packed)/16;
 -- Check all supplied IDs, including duplicates within same batch and previous
 -- committed segments. Collision/same identity rejects the complete transaction.
 FOR v_i IN 0..v_total-1 LOOP
   v_hash:=pg_catalog.substring(p_packed,v_i*16+1,16);
   IF pg_catalog.get_byte(v_hash,0)<>p_shard
      OR (v_prev IS NOT NULL AND v_hash<=v_prev) THEN
     RAISE EXCEPTION 'Unsorted, repeated or incorrect-shard V30 fingerprint';
   END IF;
   IF EXISTS (
     SELECT 1 FROM private.vision_playback_seen_segments_v30 s
      WHERE s.device_id=p_device AND s.shard=p_shard
      AND private.vision_playback_packed_contains_v30(s.fingerprints,v_hash)
   ) THEN
     RAISE EXCEPTION 'V30 duplicate fingerprint in segmented ledger';
   END IF;
   v_prev:=v_hash;
 END LOOP;

 SELECT s.segment_no,s.fingerprint_count INTO v_seq,v_count
 FROM private.vision_playback_seen_segments_v30 s
 WHERE s.device_id=p_device AND s.shard=p_shard
 ORDER BY s.segment_no DESC LIMIT 1;
 IF v_seq IS NULL THEN v_seq:=1; v_count:=0; END IF;
 v_i:=0;
 WHILE v_i < v_total LOOP
   IF v_count=64 THEN v_seq:=v_seq+1; v_count:=0; END IF;
   v_remaining:=v_total-v_i;
   v_take:=pg_catalog.least(64-v_count,v_remaining);
   v_chunk:=pg_catalog.substring(p_packed,v_i*16+1,v_take*16);
   IF v_count=0 THEN
     INSERT INTO private.vision_playback_seen_segments_v30(
       device_id,shard,segment_no,fingerprint_count,fingerprints
     ) VALUES(p_device,p_shard,v_seq,v_take,v_chunk);
   ELSE
     UPDATE private.vision_playback_seen_segments_v30 s
       SET fingerprints=private.vision_playback_merge_packed_v30(s.fingerprints,v_chunk),
           fingerprint_count=s.fingerprint_count+v_take
     WHERE s.device_id=p_device AND s.shard=p_shard AND s.segment_no=v_seq
       AND s.fingerprint_count=v_count;
     IF NOT FOUND THEN RAISE EXCEPTION 'V30 segmented append lost its active segment'; END IF;
   END IF;
   v_i:=v_i+v_take;
   v_count:=v_count+v_take;
   v_added:=v_added+v_take;
 END LOOP;
 RETURN v_added;
END $fn$;
REVOKE ALL ON FUNCTION private.vision_playback_segment_add_v30(uuid,integer,bytea)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.vision_playback_segment_add_v30(uuid,integer,bytea)
 TO service_role;

-- Replace guard ONLY in this QA database; no existing playback_log data removed.
CREATE OR REPLACE FUNCTION private.vision_playback_replay_guard_v30()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_hash bytea;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(93030,pg_catalog.hashtext(NEW.device_id::text));
 v_hash:=private.vision_playback_fingerprint_bytes_v30(NEW.device_id,NEW.client_event_id);
 IF EXISTS (
   SELECT 1 FROM private.vision_playback_seen_segments_v30 s
   WHERE s.device_id=NEW.device_id AND s.shard=pg_catalog.get_byte(v_hash,0)
     AND private.vision_playback_packed_contains_v30(s.fingerprints,v_hash)
 ) THEN RETURN NULL; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.vision_playback_replay_guard_v30() FROM PUBLIC,anon,authenticated;

-- The existing V30 opt-in transaction and 7-day guard remain intact.

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
  ), remembered AS MATERIALIZED (
    SELECT private.vision_playback_segment_add_v30(device_id,shard,fingerprints) AS stored
    FROM hash_batch
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
         (SELECT COALESCE(sum(stored),0)::bigint FROM remembered),
         (SELECT count(*)::bigint FROM remembered)
    INTO raw_removed,groups_written,v_seen,v_buckets;
  IF raw_removed <> v_seen OR (raw_removed > 0 AND v_buckets = 0) THEN
    RAISE EXCEPTION 'V30 segmented ledger mismatch: % raw removed, % fingerprints, % buckets',raw_removed,v_seen,v_buckets;
  END IF;
  RETURN NEXT;
END $fn$;
REVOKE ALL ON FUNCTION private.vision_playback_compact_batch_v30(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.vision_playback_compact_batch_v30(integer) TO service_role;


-- No compaction invocation, DELETE, ledger TTL, or production changes in this migration.
