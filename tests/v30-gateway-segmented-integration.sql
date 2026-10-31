-- Vision V30 gateway/segmented ledger QA, disposable PostgreSQL 17 only.
-- 20 TVs in 2 companies; no connection to production resources.
CREATE TEMP TABLE qa_tvs(n int PRIMARY KEY, id uuid NOT NULL, company_id uuid NOT NULL);
INSERT INTO public.companies(id,timezone) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','America/Sao_Paulo'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','America/Sao_Paulo');
INSERT INTO qa_tvs
SELECT i,('00000000-0000-4000-8000-'||lpad(to_hex(i),12,'0'))::uuid,
       CASE WHEN i<=10 THEN 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
       ELSE 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid END
FROM generate_series(1,20) i;
INSERT INTO public.devices(id,company_id,name)
SELECT id,company_id,'TV QA '||n FROM qa_tvs;
INSERT INTO public.campaigns(id,company_id,name) VALUES
 ('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Advertiser A'),
 ('20000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Advertiser B');
INSERT INTO public.media_assets(id,company_id,name) VALUES
 ('30000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Media A'),
 ('30000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Media B');

-- Boundary test: exactly 64 in one shard, then 65 across two segments.
DO $boundary$
DECLARE
 d uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff';
 blob bytea; first64 bytea; last1 bytea; v_first bytea; shard integer;
 a integer; b integer; v_count bigint; v_digest bytea;
BEGIN
 SELECT string_agg(h,''::bytea ORDER BY h) INTO blob FROM (
   SELECT private.vision_playback_fingerprint_bytes_v30(d,'boundary-'||g::text) h
   FROM generate_series(1,30000) g
 ) fingerprints
 WHERE get_byte(h,0)=42;
 IF octet_length(blob)<65*16 THEN
   RAISE EXCEPTION 'Insufficient deterministic same-shard IDs';
 END IF;
 first64:=substring(blob,1,1024);
 last1:=substring(blob,1025,16);
 shard:=get_byte(first64,0);
 IF shard<>42 THEN RAISE EXCEPTION 'Shard mismatch'; END IF;
 IF private.vision_playback_segment_add_v30(d,shard,first64)<>64
 THEN RAISE EXCEPTION 'Wrong result for first 64 IDs'; END IF;
 SELECT count(*),sum(fingerprint_count) INTO a,v_count
 FROM private.vision_playback_seen_segments_v30
 WHERE device_id=d AND shard=shard;
 -- Avoid ambiguous PL/pgSQL shard variable in SQL by qualifying as key.
 SELECT count(*),sum(s.fingerprint_count) INTO a,v_count
 FROM private.vision_playback_seen_segments_v30 s
 WHERE s.device_id=d AND s.shard=42;
 IF a<>1 OR v_count<>64 THEN RAISE EXCEPTION '64 not in exactly one segment'; END IF;
 IF private.vision_playback_segment_add_v30(d,shard,last1)<>1
 THEN RAISE EXCEPTION '65th insert failed'; END IF;
 SELECT count(*),sum(s.fingerprint_count),max(s.fingerprint_count)
 INTO a,v_count,b FROM private.vision_playback_seen_segments_v30 s
 WHERE s.device_id=d AND s.shard=42;
 IF a<>2 OR v_count<>65 OR b<>64 THEN RAISE EXCEPTION '64/65 boundary wrong: % % %',a,v_count,b; END IF;
 BEGIN
   PERFORM private.vision_playback_segment_add_v30(d,shard,last1);
   RAISE EXCEPTION 'Repeated hash should be rejected';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE 'V30 duplicate fingerprint%' THEN RAISE; END IF;
 END;
 IF (SELECT sum(s.fingerprint_count) FROM private.vision_playback_seen_segments_v30 s WHERE s.device_id=d AND s.shard=42)<>65
 THEN RAISE EXCEPTION 'Duplicate changed segment counts'; END IF;
 RAISE NOTICE 'PASS_BOUNDARY 64 hashes in segment1, 65th in segment2, replay rejected';
END $boundary$;

-- 100 plays per TV, two independent companies, all older than seven received days.
INSERT INTO public.playback_logs(
 client_event_id,company_id,device_id,campaign_id,media_id,
 started_at,created_at,duration_seconds,completed)
SELECT 'multi-'||n::text, t.company_id,t.id,
       CASE WHEN t.n<=10 THEN '20000000-0000-4000-8000-000000000001'::uuid
       ELSE '20000000-0000-4000-8000-000000000002'::uuid END,
       CASE WHEN t.n<=10 THEN '30000000-0000-4000-8000-000000000001'::uuid
       ELSE '30000000-0000-4000-8000-000000000002'::uuid END,
       (((now() AT TIME ZONE 'America/Sao_Paulo')::date-31)::timestamp
         AT TIME ZONE 'America/Sao_Paulo')+n*interval '1 second',
       now()-interval '9 days',15,true
FROM qa_tvs t CROSS JOIN generate_series(1,100) n;

-- Simulate Player authentication at gateway boundary: company comes from device.
DO $reports$
DECLARE
 c1 uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 c2 uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 d uuid;
 day date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date-31;
 before_a jsonb;before_b jsonb; after_a jsonb;after_b jsonb;
 n bigint; removed bigint:=0; loops int:=0; t0 timestamptz; ms numeric;
BEGIN
 PERFORM set_config('vision.test_company',c1::text,true);
 SELECT public.get_playback_report_compacted_v30(c1,day,day) INTO before_a;
 PERFORM set_config('vision.test_company',c2::text,true);
 SELECT public.get_playback_report_compacted_v30(c2,day,day) INTO before_b;
 IF (before_a->'summary'->>'started')::int<>1000 OR (before_b->'summary'->>'started')::int<>1000
 THEN RAISE EXCEPTION 'Baseline two-tenant counts wrong'; END IF;
 UPDATE private.vision_playback_compaction_control_v30 SET raw_days=7,enabled=true,
 archive_verified_at=now(),reporting_verified_at=now(),
 offline_replay_verified_at=now(),dedupe_verified_at=now() WHERE id=1;
 t0:=clock_timestamp();
 LOOP
   SELECT raw_removed INTO n FROM private.vision_playback_compact_batch_v30(250);
   removed:=removed+n;loops:=loops+1;
   EXIT WHEN n=0;
   IF loops>100 THEN RAISE EXCEPTION 'Compaction batch did not converge'; END IF;
 END LOOP;
 ms:=1000*extract(epoch FROM clock_timestamp()-t0);
 IF removed<>2000 THEN RAISE EXCEPTION 'Expected 2000 archived, got %',removed; END IF;
 IF (SELECT count(DISTINCT device_id) FROM public.vision_playback_daily_archive_v30)<>20
 THEN RAISE EXCEPTION 'Some TVs not summarized'; END IF;
 PERFORM set_config('vision.test_company',c1::text,true);
 SELECT public.get_playback_report_compacted_v30(c1,day,day) INTO after_a;
 PERFORM set_config('vision.test_company',c2::text,true);
 SELECT public.get_playback_report_compacted_v30(c2,day,day) INTO after_b;
 IF before_a->'summary' IS DISTINCT FROM after_a->'summary'
 OR before_b->'summary' IS DISTINCT FROM after_b->'summary'
 THEN RAISE EXCEPTION 'Tenant report parity broken'; END IF;
 FOR d IN SELECT id FROM qa_tvs LOOP
   PERFORM set_config('vision.test_company',(SELECT company_id::text FROM qa_tvs WHERE id=d),true);
   IF (public.get_playback_report_compacted_v30((SELECT company_id FROM qa_tvs WHERE id=d),day,day,NULL,d)->'summary'->>'started')::int<>100
   THEN RAISE EXCEPTION 'TV history missing for %',d; END IF;
 END LOOP;
 RAISE NOTICE 'PASS_MULTI_TV devices=20 companies=2 plays=2000 batches=% archive_ms=% per_tv=100',loops,round(ms,2);
END $reports$;

-- ON CONFLICT DO NOTHING reproduces PostgREST ignoreDuplicates: an already
-- archived ID must do NOTHING without error, then gateway may ACK its ID.
DO $ack$
DECLARE d uuid; c uuid; n bigint; t0 timestamptz; ms numeric;
BEGIN
 SELECT id,company_id INTO d,c FROM qa_tvs WHERE n=1;
 WITH accepted AS (
  INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
  VALUES('multi-1',c,d,now()-interval '400 days',true)
  ON CONFLICT(device_id,client_event_id) DO NOTHING RETURNING 1
 ) SELECT count(*) INTO n FROM accepted;
 IF n<>0 THEN RAISE EXCEPTION 'Old retry accepted after archive'; END IF;
 -- Same ID remains valid for another TV.
 INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
 SELECT 'multi-1',company_id,id,now(),true FROM qa_tvs WHERE n=2;
 IF (SELECT count(*) FROM public.playback_logs WHERE device_id=(SELECT id FROM qa_tvs WHERE n=2))<>1
 THEN RAISE EXCEPTION 'Cross-TV suppression'; END IF;
 t0:=clock_timestamp();
 WITH attempted AS (
  INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
  SELECT 'multi-'||((g-1)%100+1)::text, t.company_id,t.id,now()-interval '2 days',true
  FROM generate_series(1,1000) g JOIN qa_tvs t ON t.n=((g-1)%20+1)
  ON CONFLICT(device_id,client_event_id) DO NOTHING RETURNING 1
 ) SELECT count(*) INTO n FROM attempted;
 ms:=1000*extract(epoch FROM clock_timestamp()-t0);
 IF n<>0 THEN RAISE EXCEPTION 'Batch retry accepted duplicates: %',n; END IF;
 RAISE NOTICE 'PASS_GATEWAY_UPSERT archived_retries=1000 accepted_new_rows=0 retry_ms=%',round(ms,2);
END $ack$;

-- Write failure is atomic: a failed transaction must never ACK.
DO $fail$
DECLARE d uuid; c uuid; n bigint;
BEGIN
 SELECT id,company_id INTO d,c FROM qa_tvs WHERE n=3;
 BEGIN
   INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
   VALUES('network-failed-sim',c,d,now(),true);
   RAISE EXCEPTION 'synthetic gateway failure after attempted write';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'synthetic gateway failure after attempted write' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.playback_logs WHERE client_event_id='network-failed-sim')
 THEN RAISE EXCEPTION 'Failed batch leaked into database'; END IF;
 INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
 VALUES('network-failed-sim',c,d,now(),true);
 IF (SELECT count(*) FROM public.playback_logs WHERE client_event_id='network-failed-sim')<>1
 THEN RAISE EXCEPTION 'Retry lost after failed transaction'; END IF;
 RAISE NOTICE 'PASS_ATOMIC_FAILURE rollback then retry stored exactly one event';
END $fail$;

-- Role-level RLS: authenticated user only sees own tenant archive, not the
-- private ledger. The fixture's is_company_member helper is synthetic.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('vision.test_company','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $rls$
DECLARE my_rows bigint; other_rows bigint;
BEGIN
 SELECT sum(started) INTO my_rows FROM public.vision_playback_daily_archive_v30
 WHERE company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 SELECT count(*) INTO other_rows FROM public.vision_playback_daily_archive_v30
 WHERE company_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 IF my_rows<>1000 OR other_rows<>0
 THEN RAISE EXCEPTION 'Cross-company archive visible: mine % other %',my_rows,other_rows; END IF;
 BEGIN
   PERFORM count(*) FROM private.vision_playback_seen_segments_v30;
   RAISE EXCEPTION 'Ledger readable to authenticated role';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS_RLS authenticated reads own 1000, other 0, cannot read private ledger';
END $rls$;
ROLLBACK;
