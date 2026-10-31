-- Baseline V30 uncompressed 128-bit UUID ledger at 100k / 300k; isolated CI only.
DO $bench$
DECLARE d uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; t0 timestamptz; elapsed numeric;
 n bigint; b bigint; i integer; found boolean; h uuid;
BEGIN
 t0:=clock_timestamp();
 INSERT INTO private.vision_playback_seen_v30(fingerprint)
 SELECT private.vision_playback_identity_v30(d,'baseline-'||g::text)
 FROM generate_series(1,100000) g;
 SELECT count(*),pg_total_relation_size('private.vision_playback_seen_v30'::regclass) INTO n,b
 FROM private.vision_playback_seen_v30;
 IF n<>100000 THEN RAISE EXCEPTION 'Old 100k ledger count mismatch'; END IF;
 elapsed:=1000*extract(epoch FROM clock_timestamp()-t0);
 RAISE NOTICE 'V30_BASELINE_100K count=% size_bytes=% bytes_per_key=% elapsed_ms=%',
 n,b,round(b::numeric/n,2),round(elapsed,2);
 t0:=clock_timestamp();
 INSERT INTO private.vision_playback_seen_v30(fingerprint)
 SELECT private.vision_playback_identity_v30(d,'baseline-'||g::text)
 FROM generate_series(100001,300000) g;
 SELECT count(*),pg_total_relation_size('private.vision_playback_seen_v30'::regclass) INTO n,b
 FROM private.vision_playback_seen_v30;
 IF n<>300000 THEN RAISE EXCEPTION 'Old 300k ledger count mismatch'; END IF;
 elapsed:=1000*extract(epoch FROM clock_timestamp()-t0);
 RAISE NOTICE 'V30_BASELINE_300K count=% size_bytes=% bytes_per_key=% elapsed_ms=%',
 n,b,round(b::numeric/n,2),round(elapsed,2);
 t0:=clock_timestamp();
 FOR i IN 1..1000 LOOP
   h:=private.vision_playback_identity_v30(d,
     CASE WHEN i<=500 THEN 'baseline-'||i::text
          ELSE 'never-in-baseline-'||i::text END);
   SELECT EXISTS(SELECT 1 FROM private.vision_playback_seen_v30 WHERE fingerprint=h) INTO found;
   IF found IS DISTINCT FROM (i<=500) THEN RAISE EXCEPTION 'Old lookup mismatch'; END IF;
 END LOOP;
 elapsed:=1000*extract(epoch FROM clock_timestamp()-t0);
 RAISE NOTICE 'V30_BASELINE_LOOKUP_1000 half_positive_half_negative_ms=%',round(elapsed,2);
 t0:=clock_timestamp();
 FOR i IN 1..500 LOOP
   INSERT INTO private.vision_playback_seen_v30(fingerprint)
   VALUES(private.vision_playback_identity_v30(d,'baseline-single-'||i::text));
 END LOOP;
 SELECT count(*),pg_total_relation_size('private.vision_playback_seen_v30'::regclass) INTO n,b
 FROM private.vision_playback_seen_v30;
 IF n<>300500 THEN RAISE EXCEPTION 'Old single append mismatch'; END IF;
 elapsed:=1000*extract(epoch FROM clock_timestamp()-t0);
 RAISE NOTICE 'V30_BASELINE_SINGLE_APPEND_500 total_ms=% size_after=%',
 round(elapsed,2),b;
END $bench$;
