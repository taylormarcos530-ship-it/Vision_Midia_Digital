-- Testes SQL apenas no Docker ephemeral 'vision_v2_qa_disposable'.
INSERT INTO qa_sequence.devices(id,stream_id,token)
 VALUES('tv1','stream1','test-token-1'),('tv2','stream2','test-token-2'),
       ('tv-concurrent','stream-c','test-c');
DO $test$
DECLARE
  tm text:=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  a jsonb; b jsonb; c jsonb; r jsonb; total bigint; done bigint;
BEGIN
  a:=jsonb_build_object('sequence',1,'media','A','played_at',tm,'completed',true,'seconds',15);
  b:=jsonb_build_object('sequence',2,'media','A','played_at',tm,'completed',false,'seconds',15);
  c:=jsonb_build_object('sequence',3,'media','B','played_at',tm,'completed',true,'seconds',15);
  r:=qa_sequence.accept_batch('tv1','stream1','test-token-1',jsonb_build_array(a,b));
  IF (r->>'accepted')::int<>2 OR (r->>'ack')::int<>2 THEN RAISE EXCEPTION 'FAIL_INITIAL_ACK %',r; END IF;
  r:=qa_sequence.accept_batch('tv1','stream1','test-token-1',jsonb_build_array(a,b));
  IF (r->>'accepted')::int<>0 OR (r->>'duplicates')::int<>2 THEN RAISE EXCEPTION 'FAIL_DUPLICATE_ACK %',r; END IF;
  SELECT sum(starts),sum(completes) INTO total,done FROM qa_sequence.daily WHERE device_id='tv1';
  IF total<>2 OR done<>1 THEN RAISE EXCEPTION 'FAIL_INITIAL_AGGREGATES %/%',total,done; END IF;
  BEGIN
    PERFORM qa_sequence.accept_batch('tv1','stream1','test-token-1',jsonb_build_array(
      jsonb_build_object('sequence',4,'media','A','played_at',tm,'completed',true,'seconds',15)));
    RAISE EXCEPTION 'FAIL_EXPECTED_GAP';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='FAIL_EXPECTED_GAP' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM qa_sequence.accept_batch('tv1','stream1','wrong-token',jsonb_build_array(c));
    RAISE EXCEPTION 'FAIL_EXPECTED_DENIAL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='FAIL_EXPECTED_DENIAL' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM qa_sequence.accept_batch('tv2','stream1','test-token-2',jsonb_build_array(c));
    RAISE EXCEPTION 'FAIL_EXPECTED_TENANT_ISOLATION';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='FAIL_EXPECTED_TENANT_ISOLATION' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM qa_sequence.accept_batch('tv1','stream1','test-token-1',
      jsonb_build_array(c,jsonb_build_object('sequence',4,'media','B','played_at',
        '1970-01-01T00:00:00Z','completed',true,'seconds',15)));
    RAISE EXCEPTION 'FAIL_EXPECTED_CLOCK_REJECTION';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='FAIL_EXPECTED_CLOCK_REJECTION' THEN RAISE; END IF;
  END;
  SELECT sum(starts) INTO total FROM qa_sequence.daily WHERE device_id='tv1';
  IF total<>2 THEN RAISE EXCEPTION 'FAIL_PARTIAL_WRITE %',total; END IF;
  r:=qa_sequence.accept_batch('tv1','stream1','test-token-1',jsonb_build_array(b,c));
  IF (r->>'ack')::int<>3 OR (r->>'accepted')::int<>1 OR (r->>'duplicates')::int<>1
    THEN RAISE EXCEPTION 'FAIL_MIXED_ACK %',r; END IF;
  SELECT sum(starts),sum(completes) INTO total,done FROM qa_sequence.daily WHERE device_id='tv1';
  IF total<>3 OR done<>2 THEN RAISE EXCEPTION 'FAIL_RECONCILIATION %/%',total,done; END IF;
  IF (SELECT count(*) FROM qa_sequence.daily WHERE device_id='tv2')<>0
    THEN RAISE EXCEPTION 'FAIL_CROSS_TV'; END IF;
  RAISE NOTICE 'PASS_SQL_ACK_DUPLICATE_GAP_CLOCK_ISOLATION_ATOMICITY total=% done=%',total,done;
END $test$;
