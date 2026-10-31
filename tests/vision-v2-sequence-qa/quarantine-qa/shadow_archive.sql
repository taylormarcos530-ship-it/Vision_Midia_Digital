-- Disposable QA only. This is an additive COPY of full proofs, NOT retention.
-- NO DELETE, TRUNCATE, DROP, or source mutation in this archive schema.
DO $$
BEGIN
 IF current_database() <> 'vision_v2_quarantine_disposable' THEN
    RAISE EXCEPTION 'NO-GO: not disposable database';
 END IF;
END $$;

CREATE SCHEMA v2_archive_shadow_qa;
REVOKE ALL ON SCHEMA v2_archive_shadow_qa FROM PUBLIC;

CREATE TABLE v2_archive_shadow_qa.proofs
 (LIKE v2_quarantine_qa.receipts INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE v2_archive_shadow_qa.proofs
 ADD PRIMARY KEY(device_id,stream_id,sequence);

CREATE TABLE v2_archive_shadow_qa.manifests (
 device_id TEXT NOT NULL,
 stream_id TEXT NOT NULL,
 first_seq BIGINT NOT NULL,
 last_seq BIGINT NOT NULL,
 proofs_count INTEGER NOT NULL CHECK(proofs_count>0),
 digest_sha256 CHAR(64) NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(device_id,stream_id,first_seq,last_seq)
);

CREATE FUNCTION v2_archive_shadow_qa.deny_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'archive_immutable';
END $$;

CREATE TRIGGER archive_proof_immutable_update
BEFORE UPDATE OR DELETE ON v2_archive_shadow_qa.proofs
FOR EACH ROW EXECUTE FUNCTION v2_archive_shadow_qa.deny_mutation();

CREATE TRIGGER archive_manifest_immutable_update
BEFORE UPDATE OR DELETE ON v2_archive_shadow_qa.manifests
FOR EACH ROW EXECUTE FUNCTION v2_archive_shadow_qa.deny_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA v2_archive_shadow_qa FROM PUBLIC;
