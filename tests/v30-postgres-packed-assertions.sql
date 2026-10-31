-- Vision V30 packed ledger QA - disposable Postgres 17 only.
DO $qa$
DECLARE
 c uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 other uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 d1 uuid:='10000000-0000-4000-8000-000000000001';
 d2 uuid:='10000000-0000-4000-8000-000000000002';
 a1 uuid:='20000000-0000-4000-8000-000000000001';
 a2 uuid:='20000000-0000-4000-8000-000000000002';
 m1 uuid:='30000000-0000-4000-8000-000000000001';
 m2 uuid:='30000000-0000-4000-8000-000000000002';
 day date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date-30;
 t timestamptz:=(((now() AT TIME ZONE 'America/Sao_Paulo')::date-30)::timestamp AT TIME ZONE 'America/Sao_Paulo')+interval '12 hours';
 before_report jsonb; after_report jsonb; n bigint; n2 bigint; fp bytea; k smallint;
BEGIN
 INSERT INTO public.companies VALUES(c,'America/Sao_Paulo'),(other,'America/Sao_Paulo');
 INSERT INTO public.devices VALUES(d1,c,'TV A'),(d2,c,'TV B');
 INSERT INTO public.campaigns VALUES(a1,c,'Advertiser A'),(a2,c,'Advertiser B');
 INSERT INTO public.media_assets VALUES(m1,c,'Media A'),(m2,c,'Media B');
 INSERT INTO public.vision_commercial_daily VALUES(a1,gen_random_uuid(),d1,day,27,26);
 INSERT INTO public.playback_logs(client_event_id,company_id,device_id,campaign_id,media_id,started_at,ended_at,duration_seconds,completed,created_at)
 VALUES ('a',c,d1,a1,m1,t,t+interval '15 sec',15,true,now()-interval '15 days'),
        ('b',c,d1,a1,m1,t+interval '20 sec',NULL,5,false,now()-interval '15 days'),
        ('c',c,d2,a2,m2,t+interval '40 sec',t+interval '55 sec',15,true,now()-interval '15 days'),
        ('offline-late',c,d1,a1,m1,t+interval '70 sec',t+interval '85 sec',15,true,now()-interval '1 day'),
        ('clock-future',c,d1,a1,m1,now()+interval '2 hours',NULL,0,false,now()-interval '15 days');
 PERFORM set_config('vision.test_company',c::text,true);
 SELECT public.get_playback_report_compacted_v30(c,day,day) INTO before_report;
 IF (before_report->'summary'->>'started')::integer<>4 THEN RAISE EXCEPTION 'Invalid baseline report'; END IF;
 BEGIN
   PERFORM private.vision_playback_compact_batch_v30(250);
   RAISE EXCEPTION 'Unsafe: compaction enabled before approvals';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE 'Vision compaction disabled:%' THEN RAISE; END IF;
 END;
 UPDATE private.vision_playback_compaction_control_v30 SET enabled=true,
   archive_verified_at=now(), reporting_verified_at=now(),
   offline_replay_verified_at=now(), dedupe_verified_at=now() WHERE id=1;
 SELECT raw_removed INTO n FROM private.vision_playback_compact_batch_v30(250);
 SELECT raw_removed INTO n2 FROM private.vision_playback_compact_batch_v30(250);
 IF n+n2<>3 THEN RAISE EXCEPTION 'Expected 3 archived, got %',n+n2; END IF;
 SELECT public.get_playback_report_compacted_v30(c,day,day) INTO after_report;
 IF before_report->'summary' IS DISTINCT FROM after_report->'summary'
 THEN RAISE EXCEPTION 'Totals diverged after compaction: % => %',before_report->'summary',after_report->'summary'; END IF;
 IF (SELECT count(*) FROM private.vision_playback_seen_packed_v30)<2 THEN
   RAISE EXCEPTION 'Missing packed buckets';
 END IF;
 IF (SELECT (public.get_playback_report_compacted_v30(c,day,day,a1,NULL)->'summary'->>'started')::int)<>3
 OR (SELECT (public.get_playback_report_compacted_v30(c,day,day,NULL,d2)->'summary'->>'started')::int)<>1
 THEN RAISE EXCEPTION 'Advertiser or TV totals broken'; END IF;
 fp:=private.vision_playback_fingerprint_bytes_v30(d1,'a');
 IF NOT EXISTS(SELECT 1 FROM private.vision_playback_seen_packed_v30
               WHERE device_id=d1 AND shard=get_byte(fp,0)
               AND private.vision_playback_packed_contains_v30(fingerprints,fp))
 THEN RAISE EXCEPTION 'Archived hash not found'; END IF;
 WITH ins AS (
  INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
  VALUES('a',c,d1,now()-interval '150 days',true)
  ON CONFLICT DO NOTHING RETURNING 1
 ) SELECT count(*) INTO n FROM ins;
 IF n<>0 THEN RAISE EXCEPTION 'Replay after archive accepted'; END IF;
 INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
 VALUES('a',c,d2,now(),true);
 IF (SELECT count(*) FROM public.playback_logs WHERE client_event_id='a')<>1
 THEN RAISE EXCEPTION 'Cross-device event blocked'; END IF;
 IF (SELECT count(*) FROM public.playback_logs WHERE client_event_id='offline-late')<>1
 OR (SELECT count(*) FROM public.playback_logs WHERE client_event_id='clock-future')<>1
 THEN RAISE EXCEPTION 'Recent offline or bad-clock event removed'; END IF;
 UPDATE public.playback_logs SET created_at=now()-interval '10 days' WHERE client_event_id='offline-late';
 SELECT raw_removed INTO n FROM private.vision_playback_compact_batch_v30(250);
 IF n<>1 THEN RAISE EXCEPTION 'Late event not archived'; END IF;
 WITH ins AS (
  INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
  VALUES('offline-late',c,d1,t+interval '70 sec',true)
  ON CONFLICT DO NOTHING RETURNING 1
 ) SELECT count(*) INTO n FROM ins;
 IF n<>0 THEN RAISE EXCEPTION 'Offline replay double-counted'; END IF;
 IF (SELECT sum(attempt_count) FROM public.vision_commercial_daily)<>27
 THEN RAISE EXCEPTION 'Commercial count mutated'; END IF;
 PERFORM set_config('vision.test_company',other::text,true);
 BEGIN
   PERFORM public.get_playback_report_compacted_v30(c,day,day);
   RAISE EXCEPTION 'Cross-company report access granted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 RAISE NOTICE 'PASS packed archive/late replay, 2 TVs/2 advertisers, report parity, company isolation';
END $qa$;

-- Explicit duplicate fingerprint conflict must abort and leave raw row untouched.
DO $rollback$
DECLARE c uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 d uuid:='10000000-0000-4000-8000-000000000001';
 fp bytea; n bigint; g bigint; k integer;
BEGIN
 INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,created_at,completed)
 VALUES('rollback',c,d,now()-interval '12 days',now()-interval '10 days',true);
 fp:=private.vision_playback_fingerprint_bytes_v30(d,'rollback');
 INSERT INTO private.vision_playback_seen_packed_v30 AS target(device_id,shard,fingerprints)
 VALUES(d,get_byte(fp,0),fp)
 ON CONFLICT(device_id,shard) DO UPDATE
 SET fingerprints=private.vision_playback_merge_packed_v30(target.fingerprints,EXCLUDED.fingerprints);
 SELECT count(*) INTO g FROM public.vision_playback_daily_archive_v30;
 BEGIN
   PERFORM private.vision_playback_compact_batch_v30(250);
   RAISE EXCEPTION 'Failed to reject ledger/raw inconsistency';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE 'V30 duplicate fingerprint%' THEN RAISE; END IF;
 END;
 SELECT count(*) INTO n FROM public.playback_logs WHERE client_event_id='rollback';
 IF n<>1 OR (SELECT count(*) FROM public.vision_playback_daily_archive_v30)<>g
 THEN RAISE EXCEPTION 'Atomic rollback failed'; END IF;
 -- The rollback case is isolated; remove synthetic conflict before concurrency QA.
 DELETE FROM public.playback_logs WHERE client_event_id='rollback';
 -- The previously inserted fingerprint remains in the packed QA ledger.
 RAISE NOTICE 'PASS atomic rollback on ledger/raw inconsistency';
END $rollback$;

-- 20,000 deterministic synthetic identities in a distinct device, grouped by
-- first SHA-256 byte. Includes heap, PK and TOAST in the real storage metric.
WITH fingerprints AS (
  SELECT private.vision_playback_fingerprint_bytes_v30(
      'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid,'metric-'||g::text) AS h
  FROM generate_series(1,20000) AS g
), grouped AS (
  SELECT get_byte(h,0) AS shard,string_agg(h,''::bytea ORDER BY h) AS payload
  FROM fingerprints GROUP BY get_byte(h,0)
)
INSERT INTO private.vision_playback_seen_packed_v30(device_id,shard,fingerprints)
SELECT 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid,shard,payload FROM grouped;

DO $benchmark$
DECLARE d uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff';
 i integer; fp bytea; ok boolean; hits integer:=0; t0 timestamptz; ms numeric;
BEGIN
 t0:=clock_timestamp();
 FOR i IN 1..1000 LOOP
   fp:=private.vision_playback_fingerprint_bytes_v30(d,'metric-'||i::text);
   SELECT private.vision_playback_packed_contains_v30(fingerprints,fp)
     INTO ok FROM private.vision_playback_seen_packed_v30
     WHERE device_id=d AND shard=get_byte(fp,0);
   IF NOT COALESCE(ok,false) THEN RAISE EXCEPTION 'Hash % not found',i; END IF;
   hits:=hits+1;
 END LOOP;
 ms:=extract(epoch FROM clock_timestamp()-t0)*1000;
 RAISE NOTICE 'PACKED_LOOKUP_1000_HITS: % milliseconds',round(ms,2);
 IF hits<>1000 THEN RAISE EXCEPTION 'Missing packed lookups'; END IF;
END $benchmark$;

SELECT count(*) AS packed_buckets, sum(octet_length(fingerprints)/16) AS fingerprint_count,
 pg_total_relation_size('private.vision_playback_seen_packed_v30'::regclass) AS packed_table_bytes,
 round(pg_total_relation_size('private.vision_playback_seen_packed_v30'::regclass)::numeric/
 (SELECT sum(octet_length(fingerprints)/16) FROM private.vision_playback_seen_packed_v30),2) AS bytes_per_fingerprint,
 pg_indexes_size('private.vision_playback_seen_packed_v30'::regclass) AS index_bytes
 FROM private.vision_playback_seen_packed_v30;
