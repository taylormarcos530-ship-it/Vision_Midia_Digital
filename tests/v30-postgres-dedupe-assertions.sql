-- Synthetic PostgreSQL 17 QA: NEVER run against live Supabase.
DO $qa$
DECLARE
 c uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 c_other uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 d1 uuid:='10000000-0000-4000-8000-000000000001';
 d2 uuid:='10000000-0000-4000-8000-000000000002';
 a1 uuid:='20000000-0000-4000-8000-000000000001';
 a2 uuid:='20000000-0000-4000-8000-000000000002';
 m1 uuid:='30000000-0000-4000-8000-000000000001';
 m2 uuid:='30000000-0000-4000-8000-000000000002';
 day date:=(now() at time zone 'America/Sao_Paulo')::date-30;
 t timestamptz:=((((now() at time zone 'America/Sao_Paulo')::date-30)::timestamp) at time zone 'America/Sao_Paulo')+interval '12 hours';
 baseline jsonb; after_result jsonb; report1 jsonb; report2 jsonb; n bigint; n2 bigint;
BEGIN
 INSERT INTO public.companies VALUES(c,'America/Sao_Paulo'),(c_other,'America/Sao_Paulo');
 INSERT INTO public.devices VALUES(d1,c,'TV A'),(d2,c,'TV B');
 INSERT INTO public.campaigns VALUES(a1,c,'Anunciante A'),(a2,c,'Anunciante B');
 INSERT INTO public.media_assets VALUES(m1,c,'Media A'),(m2,c,'Media B');
 INSERT INTO public.vision_commercial_daily VALUES(a1,gen_random_uuid(),d1,day,27,26);
 INSERT INTO public.playback_logs(client_event_id,company_id,device_id,campaign_id,media_id,started_at,ended_at,duration_seconds,completed,created_at)
 VALUES
 ('a',c,d1,a1,m1,t,t+interval '15 s',15,true,now()-interval '15 days'),
 ('b',c,d1,a1,m1,t+interval '20 s',NULL,5,false,now()-interval '15 days'),
 ('c',c,d2,a2,m2,t+interval '40 s',t+interval '55 s',15,true,now()-interval '15 days'),
 ('offline-late',c,d1,a1,m1,t+interval '70 s',t+interval '85 s',15,true,now()-interval '1 day'),
 ('clock-future',c,d1,a1,m1,now()+interval '2 hours',NULL,0,false,now()-interval '15 days');
 PERFORM set_config('vision.test_company',c::text,true);
 SELECT public.get_playback_report_compacted_v30(c,day,day) INTO baseline;
 IF (baseline->'summary'->>'started')::integer<>4 THEN RAISE EXCEPTION 'Baseline mismatch'; END IF;
 BEGIN
  PERFORM private.vision_playback_compact_batch_v30(250);
  RAISE EXCEPTION 'Compaction should be disabled by default';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'Vision compaction disabled:%' THEN RAISE; END IF; END;
 -- ONLY FOR THE DISPOSABLE DATABASE: simulate completion of approvals.
 UPDATE private.vision_playback_compaction_control_v30 SET enabled=true,
 archive_verified_at=now(), reporting_verified_at=now(),
 offline_replay_verified_at=now(), dedupe_verified_at=now() WHERE id=1;
 SELECT raw_removed INTO n FROM private.vision_playback_compact_batch_v30(250);
 SELECT raw_removed INTO n2 FROM private.vision_playback_compact_batch_v30(250);
 IF n+n2<>3 THEN RAISE EXCEPTION 'Expected 3 archived, got %',n+n2; END IF;
 SELECT raw_removed INTO n FROM private.vision_playback_compact_batch_v30(250);
 IF n<>0 THEN RAISE EXCEPTION 'Non-idempotent repeat compaction'; END IF;
 IF (SELECT count(*) FROM private.vision_playback_seen_v30)<>3 THEN RAISE EXCEPTION '3 fingerprints expected'; END IF;
 SELECT public.get_playback_report_compacted_v30(c,day,day) INTO after_result;
 IF baseline->'summary' IS DISTINCT FROM after_result->'summary' THEN
  RAISE EXCEPTION 'Report totals changed after archive: % -> %',baseline->'summary',after_result->'summary';
 END IF;
 SELECT public.get_playback_report_compacted_v30(c,day,day,a1,NULL) INTO report1;
 SELECT public.get_playback_report_compacted_v30(c,day,day,NULL,d2) INTO report2;
 IF (report1->'summary'->>'started')::integer<>3 OR (report2->'summary'->>'started')::integer<>1 THEN
  RAISE EXCEPTION 'Advertiser/TV counts changed';
 END IF;
 -- Reinsert after original raw row is gone, with a different play date.
 WITH attempted AS (
  INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
  VALUES('a',c,d1,now()-interval '150 days',true) ON CONFLICT DO NOTHING RETURNING 1
 ) SELECT count(*) INTO n FROM attempted;
 IF n<>0 THEN RAISE EXCEPTION 'Archived event replay accepted'; END IF;
 -- The same ID from a different TV must remain valid.
 INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
 VALUES('a',c,d2,now(),true);
 IF (SELECT count(*) FROM public.playback_logs WHERE client_event_id='a')<>1 THEN RAISE EXCEPTION 'Cross-TV suppression'; END IF;
 IF (SELECT count(*) FROM public.playback_logs WHERE client_event_id='offline-late')<>1 THEN RAISE EXCEPTION 'Late offline event lost'; END IF;
 IF (SELECT count(*) FROM public.playback_logs WHERE client_event_id='clock-future')<>1 THEN RAISE EXCEPTION 'Future-clock event discarded'; END IF;
 UPDATE public.playback_logs SET created_at=now()-interval '10 days' WHERE client_event_id='offline-late';
 SELECT raw_removed INTO n FROM private.vision_playback_compact_batch_v30(250);
 IF n<>1 THEN RAISE EXCEPTION 'Late event did not archive after grace period'; END IF;
 WITH attempted AS (
  INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
  VALUES('offline-late',c,d1,t+interval '70 s',true) ON CONFLICT DO NOTHING RETURNING 1
 ) SELECT count(*) INTO n FROM attempted;
 IF n<>0 THEN RAISE EXCEPTION 'Offline late replay accepted'; END IF;
 IF (SELECT sum(attempt_count) FROM public.vision_commercial_daily)<>27 THEN RAISE EXCEPTION 'Commercial counter changed'; END IF;
 PERFORM set_config('vision.test_company',c_other::text,true);
 BEGIN
   PERFORM public.get_playback_report_compacted_v30(c,day,day);
   RAISE EXCEPTION 'Cross-company report access should be denied';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 RAISE NOTICE 'PASS: 2 TVs, 2 advertisers, report parity, old replay, cross-TV scope, late offline, no commercial recount, tenant RLS';
END $qa$;

-- A ledger uniqueness conflict during compaction must roll back the raw deletion.
DO $rollback$
DECLARE
 c uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 d uuid:='10000000-0000-4000-8000-000000000001';
 n bigint; ar bigint;
BEGIN
 INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,created_at,completed)
 VALUES('rollback',c,d,now()-interval '12 days',now()-interval '10 days',true);
 INSERT INTO private.vision_playback_seen_v30(fingerprint)
 VALUES(private.vision_playback_identity_v30(d,'rollback'));
 SELECT count(*) INTO ar FROM public.vision_playback_daily_archive_v30;
 BEGIN
  PERFORM private.vision_playback_compact_batch_v30(250);
  RAISE EXCEPTION 'Compaction should have rejected existing fingerprint';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 SELECT count(*) INTO n FROM public.playback_logs WHERE client_event_id='rollback';
 IF n<>1 OR (SELECT count(*) FROM public.vision_playback_daily_archive_v30)<>ar THEN
  RAISE EXCEPTION 'Atomic rollback failed';
 END IF;
 -- Clean synthetic deliberately conflicting rows so the race test can proceed.
 DELETE FROM public.playback_logs WHERE client_event_id='rollback';
 DELETE FROM private.vision_playback_seen_v30
 WHERE fingerprint=private.vision_playback_identity_v30(d,'rollback');
 RAISE NOTICE 'PASS: duplicate fingerprint fails closed, raw and archive unchanged';
END $rollback$;

-- Empirical heap+index cost of 20,000 unique event fingerprints.
INSERT INTO private.vision_playback_seen_v30(fingerprint)
SELECT private.vision_playback_identity_v30('ffffffff-ffff-4fff-8fff-ffffffffffff','metric-'||g::text)
FROM generate_series(1,20000) g ON CONFLICT DO NOTHING;
SELECT count(*) AS ledger_rows,
pg_total_relation_size('private.vision_playback_seen_v30'::regclass) AS ledger_bytes,
round(pg_total_relation_size('private.vision_playback_seen_v30'::regclass)::numeric/count(*),2) AS bytes_per_key
FROM private.vision_playback_seen_v30;
