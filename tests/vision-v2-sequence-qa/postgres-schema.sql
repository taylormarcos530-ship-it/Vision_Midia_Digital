-- Apenas para PostgreSQL 17 LOCAL DESCARTAVEL (Docker), NUNCA Supabase.
DO $guard$ BEGIN
  IF current_database() <> 'vision_v2_qa_disposable' THEN
    RAISE EXCEPTION 'NO-GO: database not disposable';
  END IF;
END $guard$;
CREATE SCHEMA qa_sequence;
CREATE TABLE qa_sequence.devices(
  id text PRIMARY KEY,
  stream_id text NOT NULL,
  token text NOT NULL,
  watermark bigint NOT NULL DEFAULT 0 CHECK(watermark>=0)
);
CREATE TABLE qa_sequence.daily(
  device_id text NOT NULL REFERENCES qa_sequence.devices(id),
  day date NOT NULL,
  media_id text NOT NULL,
  starts bigint NOT NULL DEFAULT 0,
  completes bigint NOT NULL DEFAULT 0,
  total_seconds numeric NOT NULL DEFAULT 0,
  PRIMARY KEY(device_id,day,media_id)
);
CREATE OR REPLACE FUNCTION qa_sequence.accept_batch(
  p_device text,p_stream text,p_token text,p_events jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE
  v_watermark bigint; v_expected bigint; v_prior bigint:=0;
  v_event jsonb; v_seq bigint; v_time timestamptz; v_media text;
  v_accepted integer:=0; v_duplicate integer:=0; v_localday date;
BEGIN
  SELECT watermark INTO v_watermark FROM qa_sequence.devices
   WHERE id=p_device AND stream_id=p_stream AND token=p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unauthorized_or_stale_stream'; END IF;
  IF p_events IS NULL OR jsonb_typeof(p_events)<>'array' OR jsonb_array_length(p_events) NOT BETWEEN 1 AND 50
    THEN RAISE EXCEPTION 'invalid_batch'; END IF;
  v_expected:=v_watermark+1;
  FOR v_event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    IF jsonb_typeof(v_event) <> 'object' OR jsonb_typeof(v_event->'sequence')<>'number'
       OR jsonb_typeof(v_event->'media')<>'string' OR jsonb_typeof(v_event->'played_at')<>'string'
       OR jsonb_typeof(v_event->'completed')<>'boolean'
       OR jsonb_typeof(v_event->'seconds')<>'number'
       THEN RAISE EXCEPTION 'invalid_event'; END IF;
    v_seq:=(v_event->>'sequence')::bigint;
    v_media:=v_event->>'media';
    v_time:=(v_event->>'played_at')::timestamptz;
    IF v_seq<1 OR v_seq<=v_prior OR length(v_media)<1 OR length(v_media)>128
       OR (v_event->>'seconds')::numeric NOT BETWEEN 0 AND 3600
       OR v_time < now() - interval '370 days'
       OR v_time > now() + interval '5 minutes'
       THEN RAISE EXCEPTION 'invalid_sequence_or_clock'; END IF;
    v_prior:=v_seq;
    IF v_seq<=v_watermark THEN v_duplicate:=v_duplicate+1;
    ELSE
      IF v_seq<>v_expected THEN RAISE EXCEPTION 'gap, retry from %',v_expected; END IF;
      v_expected:=v_expected+1;
      v_accepted:=v_accepted+1;
    END IF;
  END LOOP;

  -- Uma gravacao agregada POR DIA+MIDIA NO LOTE, nao por evento.
  INSERT INTO qa_sequence.daily(device_id,day,media_id,starts,completes,total_seconds)
  SELECT p_device,((event->>'played_at')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,
         event->>'media', count(*),
         count(*) FILTER(WHERE (event->>'completed')::boolean),
         sum((event->>'seconds')::numeric)
    FROM jsonb_array_elements(p_events) AS event
   WHERE (event->>'sequence')::bigint > v_watermark
   GROUP BY ((event->>'played_at')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,event->>'media'
  ON CONFLICT(device_id,day,media_id) DO UPDATE
  SET starts=qa_sequence.daily.starts+excluded.starts,
      completes=qa_sequence.daily.completes+excluded.completes,
      total_seconds=qa_sequence.daily.total_seconds+excluded.total_seconds;

  UPDATE qa_sequence.devices SET watermark=v_expected-1 WHERE id=p_device;
  RETURN jsonb_build_object('ack',v_expected-1,'accepted',v_accepted,'duplicates',v_duplicate);
END $fn$;
