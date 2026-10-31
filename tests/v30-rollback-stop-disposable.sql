-- Vision V30: synthetic rollback rehearsal after a seven-day compaction.
-- Operates ONLY in disposable PostgreSQL 17 database vision_v30_age_ci.
DO $qa$
DECLARE c uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        d uuid := '10000000-0000-4000-8000-000000000001';
        day date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - 31;
        before_total bigint;after_total bigint;already_archived bigint;
        accepted bigint;
BEGIN
 IF current_database() <> 'vision_v30_age_ci' THEN
   RAISE EXCEPTION 'Refusing rollback rehearsal outside disposable vision_v30_age_ci';
 END IF;
 PERFORM set_config('vision.test_company',c::text,true);
 SELECT (public.get_playback_report_compacted_v30(c,day,day)->'summary'->>'started')::bigint
 INTO before_total;
 IF before_total <> 10000 THEN RAISE EXCEPTION 'Expected synthetic 10000 plays, got %',before_total; END IF;
 SELECT coalesce(sum(started),0) INTO already_archived FROM public.vision_playback_daily_archive_v30;
 IF already_archived<>8000 THEN RAISE EXCEPTION 'Synthetic archive did not contain 8000, got %',already_archived; END IF;

 UPDATE private.vision_playback_compaction_control_v30 SET enabled=false WHERE id=1;
 IF (SELECT enabled FROM private.vision_playback_compaction_control_v30 WHERE id=1)
   THEN RAISE EXCEPTION 'Emergency stop failed'; END IF;
 BEGIN
   PERFORM private.vision_playback_compact_batch_v30(100);
   RAISE EXCEPTION 'Compactor unexpectedly allowed after stop';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE 'Vision compaction disabled:%' THEN RAISE; END IF;
 END;
 SELECT (public.get_playback_report_compacted_v30(c,day,day)->'summary'->>'started')::bigint
 INTO after_total;
 IF after_total<>before_total THEN RAISE EXCEPTION 'Report changed during rollback stop'; END IF;

 WITH replay AS (
  INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
  VALUES ('old-2',c,d,now()-interval '300 days',true)
  ON CONFLICT(device_id,client_event_id) DO NOTHING RETURNING 1
 )
 SELECT count(*) INTO accepted FROM replay;
 IF accepted<>0 THEN RAISE EXCEPTION 'Replay accepted after stop'; END IF;
 IF (SELECT coalesce(sum(started),0) FROM public.vision_playback_daily_archive_v30)<>8000
 THEN RAISE EXCEPTION 'Archive was altered or lost during stop'; END IF;
 RAISE NOTICE 'PASS_ROLLBACK_STOP raw_total=% archived=% report=% replay_accepted=% enabled=false',
  (SELECT count(*) FROM public.playback_logs),already_archived,after_total,accepted;
END $qa$;
