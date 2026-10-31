-- Carga sintetica, 100 TVs x 1000 eventos, todos no mesmo dia; banco descartavel.
DO $scale$
DECLARE
  i integer; j integer; device text; payload jsonb;
  all_events bigint; all_watermarks bigint;
  bytes_devices bigint; bytes_daily bigint;
  begin_at timestamptz:=clock_timestamp(); elapsed_ms numeric;
BEGIN
  FOR i IN 1..100 LOOP
    device:='tv-scale-'||i::text;
    INSERT INTO qa_sequence.devices(id,stream_id,token)
       VALUES(device,'stream-scale','token-scale');
    FOR j IN 0..19 LOOP
      SELECT jsonb_agg(jsonb_build_object(
        'sequence',g,'media','ad-'||((g % 10)+1)::text,
        'played_at',now()::text,'completed',true,'seconds',15) ORDER BY g)
        INTO payload
        FROM generate_series(j*50+1,j*50+50) AS g;
      PERFORM qa_sequence.accept_batch(device,'stream-scale','token-scale',payload);
    END LOOP;
  END LOOP;
  SELECT sum(starts) INTO all_events FROM qa_sequence.daily WHERE device_id LIKE 'tv-scale-%';
  SELECT sum(watermark) INTO all_watermarks FROM qa_sequence.devices WHERE id LIKE 'tv-scale-%';
  IF all_events<>100000 OR all_watermarks<>100000
     THEN RAISE EXCEPTION 'FAIL_100TV_STATS events=% watermarks=%',all_events,all_watermarks;
  END IF;
  IF (SELECT count(*) FROM qa_sequence.daily WHERE device_id LIKE 'tv-scale-%')<>1000
     THEN RAISE EXCEPTION 'FAIL_DAILY_CARDINALITY';
  END IF;
  SELECT pg_total_relation_size('qa_sequence.devices'::regclass),
         pg_total_relation_size('qa_sequence.daily'::regclass)
    INTO bytes_devices,bytes_daily;
  elapsed_ms:=1000*extract(epoch FROM clock_timestamp()-begin_at);
  RAISE NOTICE 'PASS_SCALE_100_TV events=% watermark=% summary_rows=1000 devices_bytes=% daily_bytes=% total_bytes=% elapsed_ms=%',
    all_events,all_watermarks,bytes_devices,bytes_daily,bytes_devices+bytes_daily,round(elapsed_ms,2);
END $scale$;
