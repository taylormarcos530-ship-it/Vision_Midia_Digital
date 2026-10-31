-- All records below are synthetic; run ONLY on the CI disposable PostgreSQL instance.
DO $check$
DECLARE
 c1 uuid:='00000000-0000-4000-8000-000000000001';
 c2 uuid:='00000000-0000-4000-8000-000000000002';
 tv1 uuid:='10000000-0000-4000-8000-000000000001';
 tv2 uuid:='10000000-0000-4000-8000-000000000002';
 adv1 uuid:='20000000-0000-4000-8000-000000000001';
 adv2 uuid:='20000000-0000-4000-8000-000000000002';
 med1 uuid:='30000000-0000-4000-8000-000000000001';
 med2 uuid:='30000000-0000-4000-8000-000000000002';
 local_day date := ((now() at time zone 'America/Sao_Paulo')::date-20);
 t timestamptz := (((now() at time zone 'America/Sao_Paulo')::date-20)::timestamp at time zone 'America/Sao_Paulo')+interval '12 hours';
 baseline jsonb; after_report jsonb; filtered jsonb;
 removed_n bigint;grouped_n bigint;n integer;
BEGIN
 INSERT INTO public.companies VALUES(c1,'America/Sao_Paulo'),(c2,'America/Sao_Paulo');
 INSERT INTO public.devices VALUES(tv1,c1,'TV 1'),(tv2,c1,'TV 2');
 INSERT INTO public.campaigns VALUES(adv1,c1,'Anunciante A'),(adv2,c1,'Anunciante B');
 INSERT INTO public.media_assets VALUES(med1,c1,'Mídia A'),(med2,c1,'Mídia B');
 INSERT INTO public.vision_commercial_daily VALUES(adv1,gen_random_uuid(),tv1,local_day,13,12);
 INSERT INTO public.playback_logs(client_event_id,company_id,device_id,campaign_id,media_id,started_at,ended_at,duration_seconds,completed,created_at)
 VALUES
 ('a',c1,tv1,adv1,med1,t,t+interval '15 seconds',15,true,now()-interval '18 days'),
 ('b',c1,tv1,adv1,med1,t+interval '15 seconds',null,10,false,now()-interval '18 days'),
 ('c',c1,tv2,adv2,med2,t+interval '5 minutes',t+interval '5 minutes 15 seconds',15,true,now()-interval '18 days'),
 ('offline-late',c1,tv1,adv1,med1,t+interval '1 hour',t+interval '1 hour 15 seconds',15,true,now()-interval '1 day'),
 ('future-clock',c1,tv1,adv1,med1,now()+interval '2 hours',null,0,false,now()-interval '18 days');
 PERFORM set_config('vision.test_company',c1::text,true);
 SELECT public.get_playback_report_compacted_v30(c1,local_day,local_day) INTO baseline;
 IF (baseline->'summary'->>'started')::int<>4 OR (baseline->'summary'->>'completed')::int<>3 THEN
   RAISE EXCEPTION 'Incorrect raw baseline %',baseline->'summary';
 END IF;
 -- Verify compaction disabled, even with other approvals (no durable ledger yet).
 BEGIN
   PERFORM private.vision_playback_compact_batch_v30(100);
   RAISE EXCEPTION 'Compaction unexpectedly enabled';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE 'Vision compaction disabled:%' THEN RAISE; END IF;
 END;
 UPDATE private.vision_playback_compaction_control_v30 SET enabled=true,
 archive_verified_at=now(),reporting_verified_at=now(),offline_replay_verified_at=now() WHERE id=1;
 BEGIN
   PERFORM private.vision_playback_compact_batch_v30(100);
   RAISE EXCEPTION 'Dedupe gate unexpectedly bypassed';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE 'Vision compaction disabled:%' THEN RAISE; END IF;
 END;
 SELECT count(*) INTO n FROM public.playback_logs;
 IF n<>5 THEN RAISE EXCEPTION 'Disabled compaction removed rows'; END IF;
 -- Force the *synthetic* gate open ONLY for atomic transaction/summary simulation.
 UPDATE private.vision_playback_compaction_control_v30 SET dedupe_verified_at=now() WHERE id=1;
 SELECT raw_removed,groups_written INTO removed_n,grouped_n FROM private.vision_playback_compact_batch_v30(100);
 IF removed_n<>3 OR grouped_n<>2 THEN RAISE EXCEPTION 'Bad compaction %, %',removed_n,grouped_n; END IF;
 SELECT raw_removed INTO removed_n FROM private.vision_playback_compact_batch_v30(100);
 IF removed_n<>0 THEN RAISE EXCEPTION 'Compaction counted same rows twice'; END IF;
 SELECT count(*) INTO n FROM public.playback_logs;
 IF n<>2 THEN RAISE EXCEPTION 'Late or clock anomaly was removed'; END IF;
 SELECT public.get_playback_report_compacted_v30(c1,local_day,local_day) INTO after_report;
 IF (baseline->'summary'->>'started')<>(after_report->'summary'->>'started') OR
    (baseline->'summary'->>'completed')<>(after_report->'summary'->>'completed') OR
    (baseline->'summary'->>'total_seconds')<>(after_report->'summary'->>'total_seconds') THEN
   RAISE EXCEPTION 'Hybrid mismatch % vs %',baseline->'summary',after_report->'summary';
 END IF;
 SELECT public.get_playback_report_compacted_v30(c1,local_day,local_day,adv1,null) INTO filtered;
 IF (filtered->'summary'->>'started')::int<>3 THEN RAISE EXCEPTION 'Advertiser count wrong'; END IF;
 SELECT public.get_playback_report_compacted_v30(c1,local_day,local_day,null,tv2) INTO filtered;
 IF (filtered->'summary'->>'started')::int<>1 THEN RAISE EXCEPTION 'TV count wrong'; END IF;
 IF (SELECT sum(attempt_count) FROM public.vision_commercial_daily)<>13 THEN
   RAISE EXCEPTION 'Commercial summary was modified'; END IF;
 -- Important RED TEST: after deletion the old uniqueness index can no longer
 -- reject a replay. The guarded SQL must NEVER be enabled in real production.
 BEGIN
   INSERT INTO public.playback_logs(client_event_id,company_id,device_id,campaign_id,media_id,started_at,completed,created_at)
   VALUES('a',c1,tv1,adv1,med1,t,true,now());
   RAISE EXCEPTION USING ERRCODE='P1234',MESSAGE='Expected replay vulnerability proven; rollback local duplicate';
 EXCEPTION WHEN SQLSTATE 'P1234' THEN NULL;
 END;
 PERFORM set_config('vision.test_company',c2::text,true);
 BEGIN
   PERFORM public.get_playback_report_compacted_v30(c1,local_day,local_day);
   RAISE EXCEPTION 'Company access not denied';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 RAISE NOTICE 'PASS: totals, 2 TVs, 2 advertisers, late events, deny cross-company, guarded. REPLAY VULNERABILITY CONFIRMED; DO NOT ENABLE DELETION';
END $check$;
