-- Vision V2: PostgreSQL 17 disposable soak ONLY; no production migrations.
DO $$
BEGIN
 IF current_database()<>'vision_v2_quarantine_disposable'
 THEN RAISE EXCEPTION 'NO-GO: disposable DB required';
 END IF;
END $$;
CREATE SCHEMA v2_soak_qa;
REVOKE ALL ON SCHEMA v2_soak_qa FROM PUBLIC;

CREATE TABLE v2_soak_qa.devices(
 device text PRIMARY KEY, company text NOT NULL, stream text NOT NULL,
 token_sha256 text NOT NULL, watermark bigint NOT NULL DEFAULT 0
);
CREATE TABLE v2_soak_qa.receipts(
 received_month date NOT NULL,
 received_day date NOT NULL,
 company text NOT NULL,
 device text NOT NULL,
 stream text NOT NULL,
 seq bigint NOT NULL,
 event_id text NOT NULL,
 boot_id text NOT NULL,
 elapsed_ms bigint NOT NULL,
 hash_sha256 text NOT NULL,
 played_at timestamptz NULL CHECK(played_at IS NULL),
 billable boolean NOT NULL DEFAULT FALSE CHECK(billable=FALSE),
 PRIMARY KEY(received_month,device,seq)
) PARTITION BY RANGE(received_month);
CREATE TABLE v2_soak_qa.receipts_oct PARTITION OF v2_soak_qa.receipts
 FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE v2_soak_qa.receipts_nov PARTITION OF v2_soak_qa.receipts
 FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE INDEX qa_tenant_day_oct ON v2_soak_qa.receipts_oct(company,received_day);
CREATE INDEX qa_tenant_day_nov ON v2_soak_qa.receipts_nov(company,received_day);
CREATE TABLE v2_soak_qa.projectors(
 device text PRIMARY KEY REFERENCES v2_soak_qa.devices(device),
 through_seq bigint NOT NULL DEFAULT 0);
CREATE TABLE v2_soak_qa.daily_read(
 company text NOT NULL,device text NOT NULL,received_day date NOT NULL,
 pending_time bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(device,received_day)
);
CREATE INDEX qa_daily_company ON v2_soak_qa.daily_read(company,received_day);
CREATE TABLE v2_soak_qa.commands(
 device text PRIMARY KEY REFERENCES v2_soak_qa.devices(device),
 revision integer NOT NULL DEFAULT 0
);
REVOKE ALL ON ALL TABLES IN SCHEMA v2_soak_qa FROM PUBLIC;
