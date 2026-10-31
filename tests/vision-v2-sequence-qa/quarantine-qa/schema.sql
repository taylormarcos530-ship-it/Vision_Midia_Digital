-- VISION V2 QA: run ONLY against disposable local database vision_v2_quarantine_disposable.
DO $guard$
BEGIN
 IF current_database() <> 'vision_v2_quarantine_disposable' THEN
   RAISE EXCEPTION 'NO-GO: database is not disposable QA';
 END IF;
END $guard$;
CREATE SCHEMA v2_quarantine_qa;
REVOKE ALL ON SCHEMA v2_quarantine_qa FROM PUBLIC;
CREATE TABLE v2_quarantine_qa.devices(
 company_id TEXT NOT NULL,
 device_id TEXT PRIMARY KEY,
 stream_id TEXT NOT NULL,
 token_sha256 CHAR(64) NOT NULL,
 watermark BIGINT NOT NULL DEFAULT 0 CHECK(watermark>=0),
 UNIQUE(company_id,device_id)
);
CREATE TABLE v2_quarantine_qa.receipts(
 device_id TEXT NOT NULL REFERENCES v2_quarantine_qa.devices(device_id),
 company_id TEXT NOT NULL,
 stream_id TEXT NOT NULL,
 sequence BIGINT NOT NULL CHECK(sequence>0),
 event_id TEXT NOT NULL,
 media_id TEXT NOT NULL,
 boot_id TEXT NOT NULL,
 mono_ms BIGINT NOT NULL CHECK(mono_ms>=0),
 seconds NUMERIC NOT NULL CHECK(seconds BETWEEN 0 AND 3600),
 completed BOOLEAN NOT NULL,
 payload_sha256 CHAR(64) NOT NULL,
 event_played_at TIMESTAMPTZ NULL CHECK(event_played_at IS NULL),
 received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 status TEXT NOT NULL DEFAULT 'PENDING_TIME' CHECK(status='PENDING_TIME'),
 billable BOOLEAN NOT NULL DEFAULT FALSE CHECK(billable=FALSE),
 PRIMARY KEY(device_id,stream_id,sequence),
 UNIQUE(device_id,stream_id,event_id),
 FOREIGN KEY(company_id,device_id) REFERENCES v2_quarantine_qa.devices(company_id,device_id)
);
CREATE INDEX receipts_pending_by_company ON v2_quarantine_qa.receipts(company_id,device_id,sequence);
REVOKE ALL ON ALL TABLES IN SCHEMA v2_quarantine_qa FROM PUBLIC,anon,authenticated;
-- DB user in this workflow is synthetic postgres superuser; no real roles,
-- credentials, URL, schema deployment or Supabase calls.
