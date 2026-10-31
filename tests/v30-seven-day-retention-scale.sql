-- V30 seven-day retention + report integrity, DISPOSABLE PostgreSQL 17 ONLY.
-- This fixture creates synthetic identities, never reads or updates live data.
DO $qa$
DECLARE
  c uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  d1 uuid := '10000000-0000-4000-8000-000000000001';
  d2 uuid := '10000000-0000-4000-8000-000000000002';
  a1 uuid := '20000000-0000-4000-8000-000000000001';
  a2 uuid := '20000000-0000-4000-8000-000000000002';
  m1 uuid := '30000000-0000-4000-8000-000000000001';
  m2 uuid := '30000000-0000-4000-8000-000000000002';
  run_day date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - 31;
  play_at timestamptz :=
      (((now() AT TIME ZONE 'America/Sao_Paulo')::date - 31)::timestamp
       AT TIME ZONE 'America/Sao_Paulo') + interval '12 hours';
  before_report jsonb; after_report jsonb;
  before_d1 jsonb; before_d2 jsonb; before_a1 jsonb; before_a2 jsonb;
  n bigint; total_removed bigint := 0; iterations integer := 0;
BEGIN
  INSERT INTO public.companies VALUES(c,'America/Sao_Paulo');
  INSERT INTO public.devices VALUES(d1,c,'TV A'),(d2,c,'TV B');
  INSERT INTO public.campaigns VALUES(a1,c,'Anunciante A'),(a2,c,'Anunciante B');
  INSERT INTO public.media_assets VALUES(m1,c,'Midia A'),(m2,c,'Midia B');
  INSERT INTO public.vision_commercial_daily
    VALUES (a1,gen_random_uuid(),d1,run_day,100,98);
  -- 8,000 older arrivals (4,000 each TV), 2,000 arrivals from 3 days ago,
  -- and 100 suspect future-clock rows which MUST be retained.
  INSERT INTO public.playback_logs(
    client_event_id,company_id,device_id,campaign_id,media_id,
    started_at,ended_at,duration_seconds,completed,created_at)
  SELECT 'old-'||g::text,c,
       CASE WHEN g%2=0 THEN d1 ELSE d2 END,
       CASE WHEN g%2=0 THEN a1 ELSE a2 END,
       CASE WHEN g%2=0 THEN m1 ELSE m2 END,
       play_at+((g%200)*interval '1 second'),
       play_at+((g%200+15)*interval '1 second'),
       15,true,now()-interval '8 days'
  FROM generate_series(1,8000) AS g;

  INSERT INTO public.playback_logs(
    client_event_id,company_id,device_id,campaign_id,media_id,
    started_at,ended_at,duration_seconds,completed,created_at)
  SELECT 'late-'||g::text,c,
       CASE WHEN g%2=0 THEN d1 ELSE d2 END,
       CASE WHEN g%2=0 THEN a1 ELSE a2 END,
       CASE WHEN g%2=0 THEN m1 ELSE m2 END,
       play_at+((g%200)*interval '1 second'),
       play_at+((g%200+15)*interval '1 second'),
       15,true,now()-interval '3 days'
  FROM generate_series(1,2000) AS g;

  INSERT INTO public.playback_logs(
    client_event_id,company_id,device_id,campaign_id,media_id,
    started_at,completed,created_at)
  SELECT 'suspect-'||g::text,c,d1,a1,m1,now()+interval '2 hours',false,
         now()-interval '8 days'
  FROM generate_series(1,100) AS g;

  PERFORM set_config('vision.test_company',c::text,true);
  SELECT public.get_playback_report_compacted_v30(c,run_day,run_day) INTO before_report;
  SELECT public.get_playback_report_compacted_v30(c,run_day,run_day,NULL,d1) INTO before_d1;
  SELECT public.get_playback_report_compacted_v30(c,run_day,run_day,NULL,d2) INTO before_d2;
  SELECT public.get_playback_report_compacted_v30(c,run_day,run_day,a1,NULL) INTO before_a1;
  SELECT public.get_playback_report_compacted_v30(c,run_day,run_day,a2,NULL) INTO before_a2;

  IF (before_report->'summary'->>'started')::bigint <> 10000 THEN
    RAISE EXCEPTION 'Expected 10000 original plays, got %',before_report->'summary';
  END IF;
  BEGIN
    PERFORM private.vision_playback_compact_batch_v30(500);
    RAISE EXCEPTION 'V30 retention guard unexpectedly enabled';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Vision compaction disabled:%' THEN RAISE; END IF;
  END;
  -- QA database only: set retention to seven days and explicitly complete gates.
  UPDATE private.vision_playback_compaction_control_v30
  SET raw_days=7,enabled=true,archive_verified_at=now(),
      reporting_verified_at=now(),offline_replay_verified_at=now(),
      dedupe_verified_at=now() WHERE id=1;
  LOOP
    SELECT raw_removed INTO n FROM private.vision_playback_compact_batch_v30(500);
    total_removed := total_removed+n;
    iterations := iterations+1;
    IF n=0 THEN EXIT; END IF;
    IF iterations>30 THEN RAISE EXCEPTION 'Compaction loop did not finish'; END IF;
  END LOOP;
  IF total_removed <> 8000 THEN
    RAISE EXCEPTION 'Seven-day retention removed % rows instead of 8000',total_removed;
  END IF;
  IF (SELECT count(*) FROM public.playback_logs) <> 2100 THEN
    RAISE EXCEPTION 'Recent or suspect rows removed';
  END IF;
  IF (SELECT count(*) FROM public.playback_logs WHERE client_event_id LIKE 'late-%') <> 2000
     OR (SELECT count(*) FROM public.playback_logs WHERE client_event_id LIKE 'suspect-%') <> 100 THEN
    RAISE EXCEPTION 'Offline/suspect retention violated';
  END IF;
  SELECT public.get_playback_report_compacted_v30(c,run_day,run_day) INTO after_report;
  IF before_report->'summary' IS DISTINCT FROM after_report->'summary'
     OR before_d1->'summary' IS DISTINCT FROM
        (public.get_playback_report_compacted_v30(c,run_day,run_day,NULL,d1)->'summary')
     OR before_d2->'summary' IS DISTINCT FROM
        (public.get_playback_report_compacted_v30(c,run_day,run_day,NULL,d2)->'summary')
     OR before_a1->'summary' IS DISTINCT FROM
        (public.get_playback_report_compacted_v30(c,run_day,run_day,a1,NULL)->'summary')
     OR before_a2->'summary' IS DISTINCT FROM
        (public.get_playback_report_compacted_v30(c,run_day,run_day,a2,NULL)->'summary')
  THEN
    RAISE EXCEPTION 'Report changed after retention: % => %',
                    before_report->'summary',after_report->'summary';
  END IF;
  -- Replay old ID (changed play time): must remain suppressed.
  WITH attempted AS (
    INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
    VALUES('old-2',c,d1,now()-interval '400 days',true)
    ON CONFLICT DO NOTHING RETURNING 1
  )
  SELECT count(*) INTO n FROM attempted;
  IF n<>0 THEN RAISE EXCEPTION 'Expired raw ID was accepted as new playback'; END IF;
  IF (SELECT sum(attempt_count) FROM public.vision_commercial_daily) <> 100 THEN
    RAISE EXCEPTION 'Commercial figures changed';
  END IF;
  RAISE NOTICE 'PASS_7D_RETENTION raw_removed=% archive_cycles=% recent_and_suspect_retained=2100 played=10000 reports=5',total_removed,iterations;
END $qa$;
SELECT count(*) AS archived_groups,sum(started) AS archived_plays
FROM public.vision_playback_daily_archive_v30;
SELECT sum(octet_length(fingerprints)/16) AS retained_archive_identities,
       pg_total_relation_size('private.vision_playback_seen_packed_v30'::regclass) AS packed_ledger_bytes,
       pg_total_relation_size('public.vision_playback_daily_archive_v30'::regclass) AS summary_bytes
FROM private.vision_playback_seen_packed_v30;
