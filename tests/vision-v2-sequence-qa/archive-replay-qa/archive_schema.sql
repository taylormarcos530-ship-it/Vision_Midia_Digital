-- Vision V2 archive-replay QA: DISPOSABLE PG17 ONLY, no Supabase migrations.
DO $guard$
BEGIN
 IF current_database() <> 'vision_v2_quarantine_disposable' THEN
   RAISE EXCEPTION 'NO-GO: not disposable QA database';
 END IF;
END $guard$;
CREATE SCHEMA IF NOT EXISTS v2_replay_qa;
REVOKE ALL ON SCHEMA v2_replay_qa FROM PUBLIC;
CREATE TABLE v2_replay_qa.segment_manifests(
 company_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 stream_id TEXT NOT NULL,
 seq_first BIGINT NOT NULL CHECK(seq_first>0),
 seq_last BIGINT NOT NULL CHECK(seq_last>=seq_first),
 event_count INTEGER NOT NULL CHECK(event_count>0 AND event_count<=100),
 blob_basename TEXT NOT NULL CHECK(blob_basename~'^[a-z0-9_-]{5,100}[.]v2qa$'),
 blob_sha256 CHAR(64) NOT NULL,
 plain_sha256 CHAR(64) NOT NULL,
 key_id TEXT NOT NULL CHECK(key_id='qa-ephemeral-v1'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(device_id,stream_id,seq_first),
 UNIQUE(blob_basename),
 FOREIGN KEY(company_id,device_id) REFERENCES v2_quarantine_qa.devices(company_id,device_id)
);
CREATE INDEX replay_interval ON v2_replay_qa.segment_manifests
 (device_id,stream_id,seq_last);
CREATE FUNCTION v2_replay_qa.block_manifest_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'qa_manifest_immutable'; END $$;
CREATE TRIGGER manifest_immutable
 BEFORE UPDATE OR DELETE ON v2_replay_qa.segment_manifests
 FOR EACH ROW EXECUTE FUNCTION v2_replay_qa.block_manifest_mutation();
REVOKE ALL ON ALL TABLES IN SCHEMA v2_replay_qa FROM PUBLIC;

-- A restricted QA role: can query the device/manifest, but NOT receipts.
-- Does not write any ACK (archive-only replay can only return preexisting watermark).
CREATE ROLE v2_archive_reader_qa NOLOGIN;
GRANT USAGE ON SCHEMA v2_replay_qa, v2_quarantine_qa TO v2_archive_reader_qa;
GRANT SELECT ON v2_replay_qa.segment_manifests TO v2_archive_reader_qa;
GRANT SELECT ON v2_quarantine_qa.devices TO v2_archive_reader_qa;
-- No SELECT/UPDATE/DELETE on v2_quarantine_qa.receipts to this role.
