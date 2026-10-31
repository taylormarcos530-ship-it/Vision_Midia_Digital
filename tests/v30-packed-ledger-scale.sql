-- Synthetic V30 packed-ledger stress, Postgres 17 disposable CI only.
-- Use 100k and 300k unique keys + single-key append benchmark.
CREATE OR REPLACE FUNCTION private.v30_qa_load_packed(p_start integer,p_finish integer)
RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE d uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff'; n bigint;
BEGIN
 WITH hashes AS MATERIALIZED (
   SELECT private.vision_playback_fingerprint_bytes_v30(d,'scale-'||g::text) AS h
   FROM generate_series(p_start,p_finish) g
 ), shards AS MATERIALIZED (
   SELECT get_byte(h,0) AS shard,
          string_agg(h,''::bytea ORDER BY h) AS payload,
          count(*)::bigint AS n FROM hashes GROUP BY 1
 ), applied AS (
   INSERT INTO private.vision_playback_seen_packed_v30 AS dest(device_id,shard,fingerprints)
   SELECT d,shard,payload FROM shards
   ON CONFLICT(device_id,shard)
   DO UPDATE SET fingerprints=private.vision_playback_merge_packed_v30(dest.fingerprints,EXCLUDED.fingerprints)
   RETURNING 1
 )
 SELECT (SELECT sum(n) FROM shards) INTO n;
 RETURN n;
END $fn$;

-- One-time creation at 100k, then growth to 300k. Measurements include indexes/TOAST.
DO $benchmark$
DECLARE n bigint; got bigint; d uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff';
 t0 timestamptz; ms numeric; before_lsn pg_lsn; after_lsn pg_lsn;
BEGIN
 t0:=clock_timestamp();
 before_lsn:=pg_current_wal_lsn();
 SELECT private.v30_qa_load_packed(1,100000) INTO n;
 after_lsn:=pg_current_wal_lsn();
 ms:=1000*extract(epoch FROM clock_timestamp()-t0);
 IF n<>100000 THEN RAISE EXCEPTION '100k load failed: %',n; END IF;
 SELECT sum(octet_length(fingerprints)/16) INTO got
 FROM private.vision_playback_seen_packed_v30 WHERE device_id=d;
 IF got<>100000 THEN RAISE EXCEPTION '100k ledger cardinality: %',got; END IF;
 RAISE NOTICE 'V30_SCALE_100K count=% size_bytes=% bytes_per_key=% elapsed_ms=% wal_bytes_est=%',
   got,pg_total_relation_size('private.vision_playback_seen_packed_v30'::regclass),
   round(pg_total_relation_size('private.vision_playback_seen_packed_v30'::regclass)::numeric/got,2),
   round(ms,1),pg_wal_lsn_diff(after_lsn,before_lsn);
 t0:=clock_timestamp();before_lsn:=pg_current_wal_lsn();
 SELECT private.v30_qa_load_packed(100001,300000) INTO n;
 after_lsn:=pg_current_wal_lsn();
 ms:=1000*extract(epoch FROM clock_timestamp()-t0);
 SELECT sum(octet_length(fingerprints)/16) INTO got
 FROM private.vision_playback_seen_packed_v30 WHERE device_id=d;
 IF got<>300000 THEN RAISE EXCEPTION '300k ledger cardinality: %',got; END IF;
 RAISE NOTICE 'V30_SCALE_300K count=% size_bytes=% bytes_per_key=% elapsed_ms=% wal_bytes_est=%',
   got,pg_total_relation_size('private.vision_playback_seen_packed_v30'::regclass),
   round(pg_total_relation_size('private.vision_playback_seen_packed_v30'::regclass)::numeric/got,2),
   round(ms,1),pg_wal_lsn_diff(after_lsn,before_lsn);
END $benchmark$;

-- 1000 read checks (500 hits and 500 absent entries), measured together.
DO $lookup$
DECLARE d uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff';
 i integer; h bytea; present boolean; start_at timestamptz; elapsed_ms numeric;
BEGIN
 start_at:=clock_timestamp();
 FOR i IN 1..1000 LOOP
    IF i<=500 THEN
      h:=private.vision_playback_fingerprint_bytes_v30(d,'scale-'||i::text);
    ELSE
      h:=private.vision_playback_fingerprint_bytes_v30(d,'never-existing-'||i::text);
    END IF;
    SELECT private.vision_playback_packed_contains_v30(fingerprints,h)
      INTO present FROM private.vision_playback_seen_packed_v30
     WHERE device_id=d AND shard=get_byte(h,0);
    IF COALESCE(present,false) IS DISTINCT FROM (i<=500)
       THEN RAISE EXCEPTION 'Incorrect lookup at iteration %',i;
    END IF;
 END LOOP;
 elapsed_ms:=1000*extract(epoch FROM clock_timestamp()-start_at);
 RAISE NOTICE 'V30_SCALE_LOOKUP_1000 half_positive_half_negative_ms=%',round(elapsed_ms,2);
END $lookup$;

-- Measure write amplification of a real-world append pattern (single key).
DO $append$
DECLARE d uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff';
 i integer; h bytea; t0 timestamptz; ms numeric; wal0 pg_lsn; wal1 pg_lsn;
 before_sz bigint; after_sz bigint; got bigint;
BEGIN
 before_sz:=pg_total_relation_size('private.vision_playback_seen_packed_v30'::regclass);
 wal0:=pg_current_wal_lsn(); t0:=clock_timestamp();
 FOR i IN 1..500 LOOP
   h:=private.vision_playback_fingerprint_bytes_v30(d,'single-append-'||i::text);
   INSERT INTO private.vision_playback_seen_packed_v30 AS dest(device_id,shard,fingerprints)
   VALUES(d,get_byte(h,0),h)
   ON CONFLICT(device_id,shard)
   DO UPDATE SET fingerprints=private.vision_playback_merge_packed_v30(dest.fingerprints,EXCLUDED.fingerprints);
 END LOOP;
 wal1:=pg_current_wal_lsn();
 ms:=1000*extract(epoch FROM clock_timestamp()-t0);
 after_sz:=pg_total_relation_size('private.vision_playback_seen_packed_v30'::regclass);
 SELECT sum(octet_length(fingerprints)/16) INTO got FROM private.vision_playback_seen_packed_v30 WHERE device_id=d;
 IF got<>300500 THEN RAISE EXCEPTION '500 single updates incorrectly merged: %',got; END IF;
 RAISE NOTICE 'V30_SCALE_SINGLE_APPEND_500 total_ms=% size_before=% size_after=% file_growth=% wal_bytes_est=%',
   round(ms,2),before_sz,after_sz,after_sz-before_sz,pg_wal_lsn_diff(wal1,wal0);
END $append$;

-- Fail-safe: exactly reject the same ID after raw event has been summarized,
-- including a replacement started_at timestamp.
DO $replay$
DECLARE d uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff'; c uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; n bigint;
BEGIN
 WITH attempted AS (
  INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
  VALUES ('scale-123',c,d,now()-interval '150 days',true)
  ON CONFLICT DO NOTHING RETURNING 1
 ) SELECT count(*) INTO n FROM attempted;
 IF n<>0 THEN RAISE EXCEPTION 'Scaled archived ID accepted'; END IF;
 RAISE NOTICE 'PASS_SCALE_REPLAY 300500 keys, historical replays blocked';
END $replay$;
