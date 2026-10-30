-- Somente banco descartavel. NUNCA producao ou homologacao compartilhada.
BEGIN;
CREATE SCHEMA vision_gateway_test;
CREATE TABLE vision_gateway_test.device_credentials(device_id uuid PRIMARY KEY,token_hash text UNIQUE NOT NULL,revoked_at timestamptz,last_used_at timestamptz);
CREATE TABLE vision_gateway_test.device_pairing_requests(id uuid PRIMARY KEY,device_id uuid NOT NULL,status text NOT NULL,issued_token text);
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
-- Espelha o UPDATE de limpeza de token emitido pelo gateway.
-- Deve apagar somente tokens de pareamento ainda marcados como 'issued'.
INSERT INTO vision_gateway_test.device_pairing_requests VALUES
 ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','issued','temporary-token'),
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','claimed','keep-claimed');
DO $vision$
DECLARE n integer;
BEGIN
 UPDATE vision_gateway_test.device_pairing_requests SET issued_token=NULL
 WHERE device_id='11111111-1111-4111-8111-111111111111' AND status='issued';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'issued token cleanup count %',n; END IF;
 IF EXISTS (SELECT 1 FROM vision_gateway_test.device_pairing_requests WHERE status='issued' AND issued_token IS NOT NULL) THEN
  RAISE EXCEPTION 'issued token not cleared';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM vision_gateway_test.device_pairing_requests WHERE status='claimed' AND issued_token='keep-claimed') THEN
  RAISE EXCEPTION 'claimed token modified';
 END IF;
 -- O UPDATE atual ainda toca a linha mesmo quando issued_token ja e NULL.
 -- Isso revela um candidato a reducao de escrita, sem mudar producao.
 UPDATE vision_gateway_test.device_pairing_requests SET issued_token=NULL
 WHERE device_id='11111111-1111-4111-8111-111111111111' AND status='issued';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'expected current repeated update behavior %',n; END IF;
END $vision$;
ROLLBACK;
