-- Somente banco descartavel. NUNCA producao ou homologacao compartilhada.
BEGIN;
CREATE SCHEMA vision_gateway_test;
CREATE TABLE vision_gateway_test.device_credentials(device_id uuid PRIMARY KEY,token_hash text UNIQUE NOT NULL,revoked_at timestamptz,last_used_at timestamptz);
CREATE TABLE vision_gateway_test.playback_logs(device_id uuid NOT NULL,client_event_id text NOT NULL,started_at timestamptz NOT NULL,UNIQUE(device_id,client_event_id));
INSERT INTO vision_gateway_test.device_credentials VALUES ('11111111-1111-4111-8111-111111111111','fixture',NULL,NULL);
DO $$
DECLARE n integer; t timestamptz := '2026-10-30 12:00:00+00';
BEGIN
UPDATE vision_gateway_test.device_credentials SET last_used_at=t WHERE device_id='11111111-1111-4111-8111-111111111111' AND (last_used_at IS NULL OR last_used_at <= t-interval '1 hour');
GET DIAGNOSTICS n=ROW_COUNT;
IF n<>1 THEN RAISE EXCEPTION 'first write %',n; END IF;
UPDATE vision_gateway_test.device_credentials SET last_used_at=t WHERE device_id='11111111-1111-4111-8111-111111111111' AND (last_used_at IS NULL OR last_used_at <= t-interval '1 hour');
GET DIAGNOSTICS n=ROW_COUNT;
IF n<>0 THEN RAISE EXCEPTION 'duplicate write %',n; END IF;
UPDATE vision_gateway_test.device_credentials SET last_used_at=t+interval '1 hour' WHERE device_id='11111111-1111-4111-8111-111111111111' AND (last_used_at IS NULL OR last_used_at <= t);
GET DIAGNOSTICS n=ROW_COUNT;
IF n<>1 THEN RAISE EXCEPTION 'hour boundary %',n; END IF;
END $$;
INSERT INTO vision_gateway_test.playback_logs VALUES ('11111111-1111-4111-8111-111111111111','event-1','2026-10-30 12:00:00+00') ON CONFLICT DO NOTHING;
INSERT INTO vision_gateway_test.playback_logs VALUES ('11111111-1111-4111-8111-111111111111','event-1','2026-10-30 12:00:00+00') ON CONFLICT DO NOTHING;
DO $$ BEGIN IF (SELECT count(*) FROM vision_gateway_test.playback_logs)<>1 THEN RAISE EXCEPTION 'duplicate playback'; END IF; END $$;
ROLLBACK;
