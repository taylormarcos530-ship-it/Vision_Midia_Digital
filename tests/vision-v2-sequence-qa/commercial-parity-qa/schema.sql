-- V2 commercial parity and synthetic JWT/RLS. DISPOSABLE PostgreSQL17 ONLY.
DO $$BEGIN IF current_database()<>'vision_v2_quarantine_disposable' THEN RAISE EXCEPTION 'DISPOSABLE ONLY'; END IF;END$$;
CREATE SCHEMA qa_commercial;
CREATE ROLE qa_vision_app NOLOGIN;
GRANT USAGE ON SCHEMA qa_commercial TO qa_vision_app;
CREATE TABLE qa_commercial.devices(
 company_id text NOT NULL,device_id text PRIMARY KEY,
 watermark bigint NOT NULL DEFAULT 0 CHECK(watermark>=0)
);
CREATE TABLE qa_commercial.playback(
 company_id text NOT NULL,device_id text NOT NULL,
 seq bigint NOT NULL,client_event_id text NOT NULL,
 campaign_id text NOT NULL,playlist_id text NOT NULL,media_id text NOT NULL,
 device_name text NOT NULL,campaign_name text NOT NULL,
 playlist_name text NOT NULL,media_name text NOT NULL,
 started_at timestamptz NOT NULL,
 play_day date NOT NULL,seconds numeric NOT NULL CHECK(seconds>=0),
 completed bool NOT NULL,hash_sha256 text NOT NULL,
 PRIMARY KEY(device_id,seq),UNIQUE(device_id,client_event_id)
);
CREATE INDEX qa_playback_company_day ON qa_commercial.playback(company_id,play_day);
CREATE INDEX qa_playback_company_device_day ON qa_commercial.playback(company_id,device_id,play_day);
CREATE TABLE qa_commercial.pending_time(
 company_id text NOT NULL,device_id text NOT NULL,
 seq bigint NOT NULL,client_event_id text NOT NULL,hash_sha256 text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 started_at timestamptz NULL CHECK(started_at IS NULL),
 billable bool NOT NULL DEFAULT false CHECK(billable=false),
 status text NOT NULL DEFAULT 'PENDING_TIME' CHECK(status='PENDING_TIME'),
 PRIMARY KEY(device_id,seq)
);
CREATE TABLE qa_commercial.cursor(
 device_id text PRIMARY KEY,through_seq bigint NOT NULL DEFAULT 0
);
CREATE TABLE qa_commercial.daily(
 company_id text NOT NULL,device_id text NOT NULL,campaign_id text NOT NULL,
 playlist_id text NOT NULL,media_id text NOT NULL,
 device_name text NOT NULL,campaign_name text NOT NULL,
 playlist_name text NOT NULL,media_name text NOT NULL,
 play_day date NOT NULL,
 started bigint NOT NULL DEFAULT 0,completed bigint NOT NULL DEFAULT 0,
 total_seconds numeric NOT NULL DEFAULT 0,
 first_play timestamptz NOT NULL,last_play timestamptz NOT NULL,
 PRIMARY KEY(company_id,device_id,campaign_id,playlist_id,media_id,
             device_name,campaign_name,playlist_name,media_name,play_day)
);
CREATE INDEX qa_daily_company_day ON qa_commercial.daily(company_id,play_day);
GRANT SELECT,INSERT,UPDATE ON qa_commercial.devices,qa_commercial.playback,
 qa_commercial.pending_time TO qa_vision_app;
GRANT SELECT ON qa_commercial.daily TO qa_vision_app;
GRANT SELECT ON qa_commercial.cursor TO qa_vision_app;
ALTER TABLE qa_commercial.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_commercial.playback ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_commercial.pending_time ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_commercial.daily ENABLE ROW LEVEL SECURITY;
-- Reproduce tenant/device boundaries with transaction-scoped synthetic claims.
CREATE POLICY device_claim ON qa_commercial.devices TO qa_vision_app
 USING(company_id=current_setting('request.jwt.claim.company',true)
    AND (device_id=current_setting('request.jwt.claim.device',true)
      OR current_setting('request.jwt.claim.mode',true)='report'))
 WITH CHECK(company_id=current_setting('request.jwt.claim.company',true)
    AND device_id=current_setting('request.jwt.claim.device',true));
CREATE POLICY playback_claim ON qa_commercial.playback TO qa_vision_app
 USING(company_id=current_setting('request.jwt.claim.company',true)
    AND (device_id=current_setting('request.jwt.claim.device',true)
      OR current_setting('request.jwt.claim.mode',true)='report'))
 WITH CHECK(company_id=current_setting('request.jwt.claim.company',true)
    AND device_id=current_setting('request.jwt.claim.device',true)
    AND current_setting('request.jwt.claim.mode',true)='device');
CREATE POLICY pending_claim ON qa_commercial.pending_time TO qa_vision_app
 USING(company_id=current_setting('request.jwt.claim.company',true)
    AND (device_id=current_setting('request.jwt.claim.device',true)
      OR current_setting('request.jwt.claim.mode',true)='report'))
 WITH CHECK(company_id=current_setting('request.jwt.claim.company',true)
    AND device_id=current_setting('request.jwt.claim.device',true));
CREATE POLICY daily_read_claim ON qa_commercial.daily FOR SELECT TO qa_vision_app
 USING(company_id=current_setting('request.jwt.claim.company',true)
    AND current_setting('request.jwt.claim.mode',true)='report');
REVOKE ALL ON ALL TABLES IN SCHEMA qa_commercial FROM PUBLIC;
